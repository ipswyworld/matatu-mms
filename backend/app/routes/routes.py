import hashlib
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from app.database import get_db
from app.models import Route, Matatu, RouteStage, Stage, User
from app.schemas import RouteResponse, RouteCreate, RouteStageResponse, RouteGeometryResponse, RouteGeometryPoint
from app.auth import get_current_user, requires_permission
from app.audit import stage_audit_log

router = APIRouter(prefix="/api/routes", tags=["Routes"])

# A fixed categorical palette, cycled by a stable hash of each route's id —
# most routes have no `corridor` value set (only 18 of 125 do, from the
# original hand-digitized BRN pass), so coloring by corridor would leave
# most of the network gray. Hashing the id instead guarantees every route
# gets a distinct, stable color across requests without depending on
# metadata that's mostly absent.
_ROUTE_COLOR_PALETTE = [
    "#2E7D32", "#C62828", "#1565C0", "#F9A825", "#6A1B9A",
    "#00838F", "#D84315", "#4527A0", "#00695C", "#AD1457",
    "#4E342E", "#283593", "#EF6C00", "#2E7D32", "#0277BD",
    "#8E24AA", "#558B2F", "#B71C1C", "#5D4037", "#00897B",
]


def _route_color(route_id: str) -> str:
    # Python's built-in hash() is randomized per-process (PYTHONHASHSEED),
    # so it would assign a different color to the same route on every
    # restart or across worker processes — md5 is deterministic across
    # runs, which is the whole point here.
    digest = hashlib.md5(route_id.encode("utf-8")).hexdigest()
    return _ROUTE_COLOR_PALETTE[int(digest, 16) % len(_ROUTE_COLOR_PALETTE)]

@router.get("", response_model=List[RouteResponse])
async def get_routes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Retrieve routes alongside their registered vehicle count
    query = (
        select(Route, func.count(Matatu.id).label("vehicle_count"))
        .join(Matatu, Matatu.route_id == Route.id, isouter=True)
        .group_by(Route.id)
    )
    result = await db.execute(query)
    
    response = []
    for row in result.all():
        route, vehicle_count = row
        resp = RouteResponse.model_validate(route)
        resp.vehicle_count = vehicle_count
        response.append(resp)
        
    return response

@router.get("/network", response_model=List[RouteGeometryResponse])
async def get_route_network(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Every route's drawable OUTBOUND line for the network map
    (components/dashboard/RouteNetworkMap.tsx) — only geocoded stages, in
    sequence order. A route with fewer than 2 geocoded points is omitted
    entirely rather than drawing a single dangling point or a fabricated
    line; the frontend's own coverage note explains the gap if any exist.
    """
    routes = (await db.execute(select(Route))).scalars().all()
    route_stage_rows = (
        await db.execute(
            select(RouteStage, Stage)
            .join(Stage, RouteStage.stage_id == Stage.id)
            .where(RouteStage.direction == "OUTBOUND", Stage.lat.isnot(None))
            .order_by(RouteStage.route_id, RouteStage.sequence)
        )
    ).all()

    points_by_route: dict[str, list[RouteGeometryPoint]] = {}
    for route_stage, stage in route_stage_rows:
        points_by_route.setdefault(route_stage.route_id, []).append(
            RouteGeometryPoint(lat=stage.lat, lng=stage.lng)
        )

    response = []
    for route in routes:
        points = points_by_route.get(route.id, [])
        if len(points) < 2:
            continue
        response.append(
            RouteGeometryResponse(
                id=route.id,
                code=route.code,
                name=route.name,
                corridor=route.corridor,
                color=_route_color(route.id),
                points=points,
            )
        )
    return response


@router.get("/{route_id}/stages", response_model=List[RouteStageResponse])
async def get_route_stages(
    route_id: str,
    direction: str = "OUTBOUND",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ordered stage list for one route+direction — the real data behind an
    "Activate Trip" origin/destination picker (crew can only pick stages
    that actually exist on their assigned route, not free text)."""
    result = await db.execute(
        select(RouteStage, Stage)
        .join(Stage, RouteStage.stage_id == Stage.id)
        .where(RouteStage.route_id == route_id, RouteStage.direction == direction)
        .order_by(RouteStage.sequence)
    )
    rows = result.all()
    if rows:
        return [
            RouteStageResponse(stage_id=stage.id, name=stage.name, sequence=route_stage.sequence)
            for route_stage, stage in rows
        ]

    # Fallback: many vehicles are still assigned to the pre-BRN legacy
    # routes (route-1..4), which have no RouteStage rows of their own —
    # only the digitized brn-route-* routes do. Rather than leaving the
    # picker empty for those vehicles, fall back to every known stage
    # alphabetically so Activate Trip still works; once a route's real
    # stage sequence is digitized this returns that instead.
    fallback_result = await db.execute(select(Stage).order_by(Stage.name))
    return [
        RouteStageResponse(stage_id=stage.id, name=stage.name, sequence=idx)
        for idx, stage in enumerate(fallback_result.scalars().all())
    ]


@router.post("", response_model=RouteResponse, status_code=status.HTTP_201_CREATED)
async def create_route(
    payload: RouteCreate,
    current_user: User = Depends(requires_permission("manage_routes")),
    db: AsyncSession = Depends(get_db)
):
    # Verify code uniqueness
    existing_result = await db.execute(select(Route).where(Route.code == payload.code))
    if existing_result.scalars().first():
        raise HTTPException(status_code=400, detail="Route code already exists")

    new_route = Route(
        id=payload.id.lower().strip(),
        code=payload.code.strip(),
        name=payload.name.strip(),
        description=payload.description,
        fare_kes=payload.fare_kes
    )
    db.add(new_route)
    stage_audit_log(
        db, resource_type="route", resource_id=new_route.id, action="CREATE",
        user_id=current_user.id,
        new_values={"code": new_route.code, "name": new_route.name, "fareKes": new_route.fare_kes},
    )
    await db.commit()
    await db.refresh(new_route)
    return new_route
