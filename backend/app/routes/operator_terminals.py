import datetime
import math
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import OperatorTerminal, Route, Stage, User
from app.schemas import OperatorTerminalCreate, OperatorTerminalResponse, OperatorTerminalResolveRequest
from app.auth import requires_permission
from app.route_access import enforce_route_access
from app.abac import sacco_scope_query
from app.terminal_matching import match_terminal_label

router = APIRouter(prefix="/api/operator-terminals", tags=["Operator Terminals"])


async def _route_or_404(db: AsyncSession, route_id: str) -> Route:
    result = await db.execute(select(Route).where(Route.id == route_id))
    route = result.scalars().first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    return route


@router.post("", response_model=OperatorTerminalResponse, status_code=status.HTTP_201_CREATED)
async def submit_operator_terminal(
    payload: OperatorTerminalCreate,
    current_user: User = Depends(requires_permission("manage_operator_terminals")),
    db: AsyncSession = Depends(get_db),
):
    """An operator declares their real designated pick-up/drop-off area for
    one route they run. The label is auto-matched against the map (see
    app/terminal_matching.py) immediately — never left as raw text alone."""
    route = await _route_or_404(db, payload.route_id)
    await enforce_route_access(db, current_user, route)

    match = await match_terminal_label(db, payload.label)

    terminal = OperatorTerminal(
        id=f"term-{secrets.token_hex(4)}",
        sacco_id=current_user.sacco_id,
        route_id=payload.route_id,
        label=payload.label.strip(),
        stage_id=match.stage_id,
        lat=match.lat,
        lng=match.lng,
        geocoded=match.geocoded,
        match_status=match.match_status,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(terminal)
    await db.commit()
    await db.refresh(terminal)
    return terminal


@router.get("", response_model=List[OperatorTerminalResponse])
async def list_operator_terminals(
    route_id: Optional[str] = Query(None),
    match_status: Optional[str] = Query(None),
    current_user: User = Depends(requires_permission("view_operator_terminals")),
    db: AsyncSession = Depends(get_db),
):
    """Own-sacco scoped for a SACCO_OPERATOR (they only see their own
    submissions); full visibility for staff roles holding
    view_operator_terminals (ADMIN/SUPERADMIN/DIRECTOR_MOBILITY/
    CHIEF_OFFICER — mirrors view_operator_verification's role set)."""
    query = select(OperatorTerminal)
    query = sacco_scope_query(current_user, query, OperatorTerminal.sacco_id)
    if route_id:
        query = query.where(OperatorTerminal.route_id == route_id)
    if match_status:
        query = query.where(OperatorTerminal.match_status == match_status)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/nearest")
async def nearest_terminal(
    lat: float = Query(...),
    lng: float = Query(...),
    current_user: User = Depends(requires_permission("view_operator_terminals")),
    db: AsyncSession = Depends(get_db),
):
    """Plain Python haversine over geocoded stages — no PostGIS anywhere in
    this codebase despite the extension being enabled, so this doesn't
    introduce a new spatial-query pattern for one endpoint."""
    result = await db.execute(select(Stage).where(Stage.geocoded == True, Stage.lat.is_not(None)))  # noqa: E712
    stages = result.scalars().all()
    if not stages:
        raise HTTPException(status_code=404, detail="No geocoded terminals available")

    def haversine_m(lat1, lng1, lat2, lng2):
        r = 6371000
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lng2 - lng1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * r * math.asin(math.sqrt(a))

    nearest = min(stages, key=lambda s: haversine_m(lat, lng, s.lat, s.lng))
    return {
        "id": nearest.id,
        "name": nearest.name,
        "lat": nearest.lat,
        "lng": nearest.lng,
        "distanceMeters": haversine_m(lat, lng, nearest.lat, nearest.lng),
    }


@router.patch("/{terminal_id}/resolve", response_model=OperatorTerminalResponse)
async def resolve_operator_terminal(
    terminal_id: str,
    payload: OperatorTerminalResolveRequest,
    current_user: User = Depends(requires_permission("resolve_operator_terminals")),
    db: AsyncSession = Depends(get_db),
):
    """Staff manually fixes an UNRESOLVED terminal — either linking it to an
    existing Stage, or hand-setting a coordinate (which creates a new
    Stage). Narrower than viewing: only ADMIN/SUPERADMIN, since this
    mutates canonical map data other passengers/operators will see."""
    result = await db.execute(select(OperatorTerminal).where(OperatorTerminal.id == terminal_id))
    terminal = result.scalars().first()
    if not terminal:
        raise HTTPException(status_code=404, detail="Terminal not found")

    if payload.stage_id:
        stage_result = await db.execute(select(Stage).where(Stage.id == payload.stage_id))
        stage = stage_result.scalars().first()
        if not stage:
            raise HTTPException(status_code=404, detail="Stage not found")
        terminal.stage_id = stage.id
        terminal.lat = stage.lat
        terminal.lng = stage.lng
        terminal.geocoded = stage.geocoded
        terminal.match_status = "MANUALLY_SET"
    elif payload.lat is not None and payload.lng is not None:
        new_stage = Stage(
            id=f"stage-{secrets.token_hex(4)}",
            name=terminal.label,
            stage_type="TERMINUS",
            lat=payload.lat,
            lng=payload.lng,
            geocoded=True,
        )
        db.add(new_stage)
        await db.flush()
        terminal.stage_id = new_stage.id
        terminal.lat = payload.lat
        terminal.lng = payload.lng
        terminal.geocoded = True
        terminal.match_status = "MANUALLY_SET"
    else:
        raise HTTPException(status_code=400, detail="Provide either stageId, or both lat and lng.")

    await db.commit()
    await db.refresh(terminal)
    return terminal
