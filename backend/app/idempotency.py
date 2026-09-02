"""
Idempotency for state-changing endpoints (Readiness List §15, §20).

Kenyan mobile networks drop and retry constantly, and mobile clients retry
on their own. Without idempotency, one user tap becomes two seat bookings,
and a redelivered NairobiPay callback credits a fine twice. At 500k users
this is not an edge case — it is a daily occurrence, and it involves money.

Contract, which follows the convention Stripe popularised because clients
and their libraries already understand it:

  * The client sends an `Idempotency-Key` header (any opaque unique string,
    typically a UUID it generates per logical operation).
  * First request with that key executes normally and its response is
    recorded.
  * A replay with the same key AND the same request body returns the
    recorded response verbatim, without re-executing anything.
  * A replay with the same key but a DIFFERENT body is a client bug —
    reusing a key for a different operation — and is refused with 409
    rather than silently returning the wrong operation's result.
  * A request with no key executes normally. Idempotency is opt-in per
    call, so existing clients keep working unchanged.

Only successful responses are recorded. Replaying a key after a failure
must be allowed to genuinely retry, or a transient 500 would poison that
key forever and the client could never complete the operation.
"""
import datetime
import hashlib
import json
import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db

logger = logging.getLogger("app.idempotency")

HEADER_NAME = "Idempotency-Key"
# How long a key is honoured. Long enough to cover any realistic retry
# (including a user reopening the app on a flaky connection), short enough
# that the table does not grow without bound.
RETENTION_HOURS = 24
MAX_KEY_LENGTH = 200


def _fingerprint(body: bytes) -> str:
    """Hash of the request body, so a replay can be checked for being the
    *same* operation without storing the original payload."""
    return hashlib.sha256(body or b"").hexdigest()


class IdempotencyContext:
    """Handed to an endpoint by the `idempotency` dependency."""

    def __init__(self, key: Optional[str], fingerprint: str, actor_id: Optional[str],
                 endpoint: str, db: AsyncSession):
        self.key = key
        self.fingerprint = fingerprint
        self.actor_id = actor_id
        self.endpoint = endpoint
        self.db = db

    @property
    def active(self) -> bool:
        return self.key is not None

    async def replay(self) -> Optional[dict]:
        """Returns the recorded response for this key, or None to proceed.

        Raises 409 if the key was used for a different request body.
        """
        if not self.key:
            return None

        from app.models import IdempotencyRecord

        record = (
            await self.db.execute(
                select(IdempotencyRecord).where(IdempotencyRecord.key == self.key)
            )
        ).scalars().first()

        if record is None:
            return None

        if record.request_fingerprint != self.fingerprint:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This Idempotency-Key was already used for a different request. "
                    "Generate a new key for a new operation."
                ),
            )

        try:
            return json.loads(record.response_body)
        except (TypeError, ValueError):
            # A corrupt record should not permanently wedge the client;
            # treat it as absent and let the request proceed.
            logger.warning("Corrupt idempotency record for key %s; re-executing.", self.key)
            return None

    async def record(self, response: dict) -> dict:
        """Stores a successful response and returns it unchanged, so call
        sites can `return await idem.record(payload)`."""
        if not self.key:
            return response

        from app.models import IdempotencyRecord

        try:
            self.db.add(IdempotencyRecord(
                key=self.key,
                actor_id=self.actor_id,
                endpoint=self.endpoint,
                request_fingerprint=self.fingerprint,
                response_body=json.dumps(response, default=str),
                created_at=datetime.datetime.now(datetime.timezone.utc),
            ))
            await self.db.commit()
        except Exception as e:
            # A duplicate insert means a concurrent request with the same
            # key won the race. That is exactly the situation idempotency
            # exists for, and the caller's own result is equivalent, so
            # this is logged rather than surfaced as an error.
            logger.info("Idempotency record not stored for %s: %s", self.key, e)
            await self.db.rollback()
        return response


async def idempotency(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> IdempotencyContext:
    key = request.headers.get(HEADER_NAME)
    if key is not None:
        key = key.strip()
        if not key or len(key) > MAX_KEY_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{HEADER_NAME} must be a non-empty string of at most {MAX_KEY_LENGTH} characters.",
            )

    # Reading the body here is safe: Starlette caches it, so the endpoint's
    # own model parsing still works afterwards.
    body = await request.body()

    actor_id = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        # Best-effort only — used to scope the key per caller in the record.
        # Real authentication is the endpoint's own dependency.
        try:
            import jwt as pyjwt_lib
            from app.config import ALGORITHM, SECRET_KEY
            payload = pyjwt_lib.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM],
                                       options={"verify_exp": False})
            actor_id = payload.get("userId") or payload.get("clientId")
        except Exception:
            pass

    return IdempotencyContext(
        key=key,
        fingerprint=_fingerprint(body),
        actor_id=actor_id,
        endpoint=f"{request.method} {request.url.path}",
        db=db,
    )


async def purge_expired(db: AsyncSession) -> int:
    """Deletes records past the retention window. Called by the maintenance
    job so the table stays bounded."""
    from sqlalchemy import delete
    from app.models import IdempotencyRecord

    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=RETENTION_HOURS)
    result = await db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.created_at < cutoff))
    await db.commit()
    return result.rowcount or 0
