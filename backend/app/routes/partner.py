"""
Partner API v1 (Readiness List §14).

The versioned, documented surface a Sacco's own system integrates against.

Two properties matter more than the endpoint list:

  * **Scoping is not reimplemented here.** Every read runs through
    `abac.sacco_scope_query`, the same function that confines a human Sacco
    operator. A partner client presents as SACCO_OPERATOR with its owning
    `sacco_id`, so it is structurally incapable of seeing another Sacco's
    vehicles — not because this module remembered to filter, but because
    the shared engine does it.

  * **The path is versioned from the first release.** Saccos have small or
    outsourced IT teams and will not upgrade on our schedule; `/api/v1/`
    means a breaking change can ship as `/api/v2/` with a long overlap
    rather than as a coordinated flag day nobody can actually coordinate.

Response shapes are deliberately narrower than the internal API's. A partner
contract should expose what a partner needs, not whatever happens to be on
the internal model — every extra field is one more thing that cannot be
changed later without breaking someone.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app import abac
from app.database import get_db
from app.models import Fine, Matatu, Route
from app.principals import Principal, is_machine, requires_scope
from app.quota import enforce_quota

logger = logging.getLogger("app.routes.partner")
router = APIRouter(prefix="/api/v1", tags=["Partner API v1"])

MAX_PAGE_SIZE = 200


@router.get("/fleet")
async def list_fleet(
    request: Request,
    limit: int = Query(50, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
    principal: Principal = Depends(requires_scope("fleet:read")),
    db: AsyncSession = Depends(get_db),
):
    """Vehicles belonging to the caller's Sacco."""
    await enforce_quota(principal, request)

    query = select(Matatu)
    # The whole scoping story in one line — the same helper human operators
    # go through. A partner client cannot widen this by crafting a request.
    query = abac.sacco_scope_query(principal, query, Matatu.sacco_id)

    rows = (await db.execute(query.limit(limit).offset(offset))).scalars().all()
    return {
        "data": [
            {
                "id": m.id,
                "registration": m.reg_number,
                "status": m.status,
                "routeId": m.route_id,
                "capacity": m.capacity,
                "saccoId": m.sacco_id,
            }
            for m in rows
        ],
        "pagination": {"limit": limit, "offset": offset, "count": len(rows)},
    }


@router.get("/fleet/{matatu_id}")
async def get_vehicle(
    matatu_id: str,
    request: Request,
    principal: Principal = Depends(requires_scope("fleet:read")),
    db: AsyncSession = Depends(get_db),
):
    await enforce_quota(principal, request)

    matatu = (await db.execute(select(Matatu).where(Matatu.id == matatu_id))).scalars().first()
    if matatu is None:
        raise HTTPException(status_code=404, detail="No vehicle with that id")
    # Single-record equivalent of the query scoping above.
    abac.enforce_own_sacco(principal, matatu.sacco_id)

    return {
        "id": matatu.id,
        "registration": matatu.reg_number,
        "status": matatu.status,
        "routeId": matatu.route_id,
        "capacity": matatu.capacity,
        "saccoId": matatu.sacco_id,
    }


@router.get("/fines")
async def list_fines(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
    principal: Principal = Depends(requires_scope("fines:read")),
    db: AsyncSession = Depends(get_db),
):
    """Fines issued against the caller's Sacco's vehicles."""
    await enforce_quota(principal, request)

    # A Fine carries no sacco_id of its own — its Sacco is whichever one
    # owns the cited vehicle. So the scope filter has to be applied to the
    # joined Matatu.sacco_id, not to the Fine. Getting this wrong is how a
    # partner ends up reading another Sacco's enforcement history, so the
    # join is explicit rather than relying on a relationship walk.
    query = select(Fine).join(Matatu, Fine.matatu_id == Matatu.id)
    query = abac.sacco_scope_query(principal, query, Matatu.sacco_id)
    if status_filter:
        query = query.where(Fine.status == status_filter.upper())

    rows = (await db.execute(query.limit(limit).offset(offset))).scalars().all()
    return {
        "data": [
            {
                "id": f.id,
                "matatuId": f.matatu_id,
                "status": f.status,
                "reason": f.reason,
                "amountKes": float(f.amount_kes) if f.amount_kes is not None else None,
                "issuedAt": f.issued_at.isoformat() if f.issued_at else None,
                "dueDate": f.due_date.isoformat() if f.due_date else None,
            }
            for f in rows
        ],
        "pagination": {"limit": limit, "offset": offset, "count": len(rows)},
    }


@router.get("/routes")
async def list_routes(
    request: Request,
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
    principal: Principal = Depends(requires_scope("fleet:read")),
    db: AsyncSession = Depends(get_db),
):
    """The county route network.

    Not Sacco-scoped: routes are public infrastructure, the same for every
    operator, and a partner needs them to interpret its own fleet's data.
    """
    await enforce_quota(principal, request)

    rows = (await db.execute(select(Route).limit(limit).offset(offset))).scalars().all()
    return {
        "data": [{"id": r.id, "name": r.name, "code": getattr(r, "code", None)} for r in rows],
        "pagination": {"limit": limit, "offset": offset, "count": len(rows)},
    }


@router.get("/whoami")
async def whoami(
    request: Request,
    principal: Principal = Depends(requires_scope("fleet:read")),
):
    """Echoes back how the caller is authenticated and scoped.

    The first thing any integrator needs when a request returns fewer rows
    than expected: whether they are scoped to the Sacco they think they are.
    Saves a support round trip on essentially every new integration.
    """
    await enforce_quota(principal, request)

    if is_machine(principal):
        return {
            "principalType": "api_client",
            "clientId": principal.client_id,
            "name": principal.name,
            "saccoId": principal.sacco_id,
            "scopes": principal.scopes,
            "quotaTier": principal.tier,
        }
    return {
        "principalType": "user",
        "userId": principal.id,
        "name": principal.name,
        "role": principal.role,
        "saccoId": principal.sacco_id,
    }
