"""
Principal resolution for endpoints that accept both humans and machines
(Readiness List §14).

`get_current_user` stays exactly as it is and remains the right dependency
for everything user-only — this adds a parallel path rather than retrofitting
thirty route files, which would be a large change with real authentication
risk for no immediate gain.

The important property: whichever principal type authenticates, the same
ABAC engine scopes it. app/abac.py duck-types on `.id`, `.sacco_id` and
`.role`, and `ApiClientPrincipal` presents all three, so a Sacco's
integration is confined to its own Sacco by exactly the rules that confine
a human Sacco operator. There is deliberately no second authorization path
to drift out of sync with the first.
"""
import logging
from typing import Optional, Union

import jwt as pyjwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api_clients import ApiClientPrincipal
from app.config import ALGORITHM, SECRET_KEY, SESSION_COOKIE_NAME
from app.database import get_db
from app.models import ApiClient, User

logger = logging.getLogger("app.principals")

Principal = Union[User, ApiClientPrincipal]

_credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_principal(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Principal:
    """Resolves either a human user or a machine client from the bearer token.

    The token type is unambiguous at decode time: a machine token carries
    `clientId` and never `userId`, so code that reads `userId` can never
    silently treat an integration as a person.
    """
    auth = request.headers.get("Authorization", "")
    jwt_token = auth[7:].strip() if auth.startswith("Bearer ") else None
    if not jwt_token:
        jwt_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not jwt_token:
        raise _credentials_exception

    try:
        payload = pyjwt.decode(jwt_token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise _credentials_exception

    client_id = payload.get("clientId")
    if client_id:
        record = (
            await db.execute(select(ApiClient).where(ApiClient.client_id == client_id))
        ).scalars().first()
        # Revocation must take effect immediately, not when the token
        # happens to expire — that is the entire point of being able to
        # revoke a leaked partner key.
        if record is None or record.revoked_at is not None:
            raise _credentials_exception
        return ApiClientPrincipal(record)

    # Human path — delegate to the existing implementation so session
    # revocation, the is_active check and every other rule stay in one place.
    from app.auth import get_current_user
    return await get_current_user(request=request, token=jwt_token, db=db)


def is_machine(principal: Principal) -> bool:
    return getattr(principal, "kind", None) == "api_client"


def audit_id(principal: Principal) -> str:
    """Audit attribution. A machine actor is prefixed so it can never be
    misread as a user id when someone is reading the trail."""
    return principal.audit_id if is_machine(principal) else principal.id


class ScopeChecker:
    """Requires a partner scope for machine callers, and the equivalent
    internal permission for humans.

    One dependency covering both is what keeps the surface unified: the
    same endpoint serves a Sacco operator in the browser and that Sacco's
    integration, with the same scoping applied to each.
    """

    def __init__(self, scope: str, *, user_permission: Optional[str] = None):
        self.scope = scope
        # Falls back to requiring any one of the permissions the scope maps
        # to, so a scope and its human equivalent cannot drift apart.
        self.user_permission = user_permission

    async def __call__(self, principal: Principal = Depends(get_current_principal)) -> Principal:
        from app.api_clients import SCOPES
        from app.rbac import has_permission

        if is_machine(principal):
            if self.scope not in principal.scopes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"This client is not granted the required scope: {self.scope}",
                )
            return principal

        required = self.user_permission
        if required is None:
            granted = SCOPES.get(self.scope, {}).get("permissions", set())
            required = next(iter(sorted(granted)), None) if granted else None

        if required and not has_permission(principal, required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You do not have permission to perform this action: {required}",
            )
        return principal


def requires_scope(scope: str, *, user_permission: Optional[str] = None) -> ScopeChecker:
    return ScopeChecker(scope, user_permission=user_permission)
