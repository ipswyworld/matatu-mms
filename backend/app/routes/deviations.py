"""
Route detours + deviation alerts API (ARCHITECTURE_DECISIONS.md §29.4).
Incident-aware alternate-road recommendation itself — matching a live
TomTom Traffic Incident against a route's pre-approved detour stretch —
needs a configured TomTom API key wired for server-side incident polling,
which isn't set up in this pass (same category as NTSA IRMS: an external
dependency, not a code gap). What's built here is the real, usable half:
detection (deviation.py, wired into telemetry ingest) and the pre-approved
detour registry that an incident-aware recommender would consult once
TomTom polling exists — the data model doesn't change when that lands,
only which signal triggers surfacing a RouteDetour to the crew app.
"""
import datetime
import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import RouteDetour, DeviationAlert, Matatu, User
from app.schemas import RouteDetourCreate, RouteDetourResponse, DeviationAlertResponse
from app.auth import requires_permission

router = APIRouter(tags=["Route Deviation"])


@router.get("/api/route-detours", response_model=List[RouteDetourResponse])
async def list_route_detours(
    current_user: User = Depends(requires_permission("view_routes")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(RouteDetour).where(RouteDetour.active == True))
    return result.scalars().all()


@router.post("/api/route-detours", response_model=RouteDetourResponse, status_code=status.HTTP_201_CREATED)
async def create_route_detour(
    payload: RouteDetourCreate,
    current_user: User = Depends(requires_permission("manage_routes")),
    db: AsyncSession = Depends(get_db),
):
    detour = RouteDetour(
        id=f"detour-{secrets.token_hex(4)}",
        route_id=payload.route_id,
        from_stage_id=payload.from_stage_id,
        to_stage_id=payload.to_stage_id,
        alternate_description=payload.alternate_description.strip(),
        active=True,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(detour)
    await db.commit()
    await db.refresh(detour)
    return detour


@router.patch("/api/route-detours/{detour_id}/deactivate", response_model=RouteDetourResponse)
async def deactivate_route_detour(
    detour_id: str,
    current_user: User = Depends(requires_permission("manage_routes")),
    db: AsyncSession = Depends(get_db),
):
    detour = (await db.execute(select(RouteDetour).where(RouteDetour.id == detour_id))).scalars().first()
    if not detour:
        raise HTTPException(status_code=404, detail="Route detour not found")
    detour.active = False
    await db.commit()
    await db.refresh(detour)
    return detour


@router.get("/api/deviation-alerts", response_model=List[DeviationAlertResponse])
async def list_deviation_alerts(
    resolved: bool = False,
    current_user: User = Depends(requires_permission("view_activity")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeviationAlert)
        .options(selectinload(DeviationAlert.matatu))
        .where(DeviationAlert.resolved == resolved)
        .order_by(DeviationAlert.detected_at.desc())
    )
    return [
        DeviationAlertResponse(
            id=a.id, matatu_id=a.matatu_id, reg_number=a.matatu.reg_number, route_id=a.route_id,
            lat=a.lat, lng=a.lng, distance_meters=a.distance_meters,
            detected_at=a.detected_at, resolved=a.resolved,
        )
        for a in result.scalars().all()
    ]


@router.patch("/api/deviation-alerts/{alert_id}/resolve", response_model=DeviationAlertResponse)
async def resolve_deviation_alert(
    alert_id: str,
    current_user: User = Depends(requires_permission("view_activity")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeviationAlert).options(selectinload(DeviationAlert.matatu)).where(DeviationAlert.id == alert_id)
    )
    alert = result.scalars().first()
    if not alert:
        raise HTTPException(status_code=404, detail="Deviation alert not found")
    alert.resolved = True
    await db.commit()
    await db.refresh(alert, attribute_names=["matatu"])
    return DeviationAlertResponse(
        id=alert.id, matatu_id=alert.matatu_id, reg_number=alert.matatu.reg_number, route_id=alert.route_id,
        lat=alert.lat, lng=alert.lng, distance_meters=alert.distance_meters,
        detected_at=alert.detected_at, resolved=alert.resolved,
    )
