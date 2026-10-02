"""
OAuth2 client-credentials flow for the partner API (Readiness List §14).

Service-to-service authentication must not reuse user sessions. A partner
integration presenting a human's token inherits that human's role and
pollutes the audit trail; the future internal ops system authenticating as
a Super Admin would be the same mistake with higher stakes.

Only the client-credentials grant is implemented, because it is the only
one that applies: there is no end-user delegation here, just a server
proving it holds a secret. Authorization-code and implicit grants would be
surface area with no consumer.
"""
import datetime
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app import api_clients, ops_limits
from app.database import get_db
from app.models import ApiClient
from app.rate_limit import limiter

logger = logging.getLogger("app.routes.oauth")
router = APIRouter(prefix="/api/oauth", tags=["Partner API — OAuth2"])


class TokenRequest(BaseModel):
    grant_type: str = "client_credentials"
    client_id: str
    client_secret: str


@router.post("/token")
@limiter.limit(ops_limits.limit_callable("oauth_token"))
async def issue_token(
    request: Request,
    body: TokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchanges client credentials for a short-lived bearer token."""
    if body.grant_type != "client_credentials":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only the client_credentials grant type is supported.",
        )

    record = (
        await db.execute(select(ApiClient).where(ApiClient.client_id == body.client_id))
    ).scalars().first()

    # One indistinguishable error for unknown client, wrong secret, and
    # revoked client. Telling a caller which of the three it was is a free
    # enumeration oracle for anyone probing client ids.
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid client credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if record is None:
        raise invalid
    if record.revoked_at is not None:
        logger.warning("Token requested for revoked client %s", body.client_id)
        raise invalid
    if not api_clients.verify_secret(body.client_secret, record.client_secret_hash):
        logger.warning("Invalid secret presented for client %s", body.client_id)
        raise invalid

    record.last_used_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()

    principal = api_clients.ApiClientPrincipal(record)
    return api_clients.mint_token(principal)


@router.get("/scopes")
async def list_scopes():
    """The published scope catalogue.

    Deliberately unauthenticated: it is a contract document, contains no
    tenant data, and a partner needs it to build an integration before
    they necessarily hold working credentials.
    """
    return {
        "scopes": api_clients.all_scopes(),
        "quotaTiers": [
            {"tier": tier, "limit": limit} for tier, limit in api_clients.QUOTA_TIERS.items()
        ],
        "tokenTtlSeconds": api_clients.TOKEN_TTL_SECONDS,
    }
