from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from app.database import get_db
from app.models import Route, Matatu, RouteStage, Stage, User
from app.schemas import RouteResponse, RouteCreate, RouteStageResponse
from app.auth import get_current_user, requires_permission
from app.audit import stage_audit_log

router = APIRouter(prefix="/api/routes", tags=["Routes"])

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
