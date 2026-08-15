"""
Session revocation (ARCHITECTURE_DECISIONS.md §19) — "JWTs are currently
valid until expiry with no revocation path; a compromised token cannot be
killed. A token denylist in Redis is the usual minimum."

Implemented as a per-user "revoked before" timestamp rather than a
per-token denylist (which would need a stable token identifier — this
codebase's JWTs don't carry a `jti` claim, and adding one plus tracking
every issued token is more machinery than this needs): revoking a user's
sessions stamps `revoked_before = now()`, and any token whose `iat`
predates that stamp is rejected on the next request, regardless of its
`exp`. Coarser than true per-token revocation (revokes everything at once,
not one specific stolen token), but that's exactly what "log this
compromised account out everywhere" actually needs, and needs zero new
token machinery to work — the `iat` claim is the only addition.

Fails open on a Redis error: an unreachable Redis degrades to "revocation
doesn't work right now," never to "nobody can log in" — matches every
other fail-open Redis usage in this codebase (app/realtime.py's publish(),
app/streams.py's publish_event()).
"""
import datetime
import logging

from app.realtime import get_redis

logger = logging.getLogger("app.session_revocation")

REVOKED_BEFORE_KEY_PREFIX = "session:revoked_before:"
# Matches the token's own max lifetime — no point remembering a
# revocation stamp longer than the longest-lived token it could still
# need to reject.
REVOCATION_TTL_SECONDS = 60 * 60 * 24 * 7


async def revoke_all_sessions(user_id: str) -> None:
    try:
        r = await get_redis()
        now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
        await r.set(f"{REVOKED_BEFORE_KEY_PREFIX}{user_id}", str(now_ts), ex=REVOCATION_TTL_SECONDS)
    except Exception:
        logger.warning("Failed to record session revocation for user %s", user_id, exc_info=True)


async def is_token_revoked(user_id: str, issued_at: float) -> bool:
    try:
        r = await get_redis()
        revoked_before_raw = await r.get(f"{REVOKED_BEFORE_KEY_PREFIX}{user_id}")
        if revoked_before_raw is None:
            return False
        return issued_at < float(revoked_before_raw)
    except Exception:
        logger.warning("Failed to check session revocation for user %s — failing open", user_id, exc_info=True)
        return False
