"""Trip activation + terminal queue (roadmap: "Activate Trip" + crew queue
system). A Trip is a crew-declared commitment to one direction (origin →
destination stage) for one vehicle. QUEUED trips at the same stage+route
are the terminal queue passengers/crew see; only one active trip (QUEUED or
IN_PROGRESS) exists per vehicle at a time — activating a new one cancels
whatever was still open, since a real vehicle can only be doing one trip.
"""
import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Trip, Matatu, Route, Stage, User
from app.schemas import TripActivateRequest, TripCompleteRequest, TripResponse, QueueStatusResponse
from app.auth import requires_permission
from app.abac import enforce_own_sacco

router = APIRouter(prefix="/api/trips", tags=["Trips"])

ACTIVE_STATUSES = ("QUEUED", "IN_PROGRESS")


def _to_response(trip: Trip) -> TripResponse:
    return TripResponse(
        id=trip.id,
        matatu_id=trip.matatu_id,
        reg_number=trip.matatu.reg_number,
        route_id=trip.route_id,
        route_name=trip.route.name,
        origin_stage_id=trip.origin_stage_id,
        origin_stage_name=trip.origin_stage.name,
        destination_stage_id=trip.destination_stage_id,
        destination_stage_name=trip.destination_stage.name,
        status=trip.status,
        started_at=trip.started_at,
        departed_at=trip.departed_at,
        ended_at=trip.ended_at,
        passenger_count=trip.passenger_count,
    )


async def _load_trip(db: AsyncSession, trip_id: str) -> Trip:
    result = await db.execute(
        select(Trip)
        .where(Trip.id == trip_id)
        .options(
            selectinload(Trip.matatu), selectinload(Trip.route),
            selectinload(Trip.origin_stage), selectinload(Trip.destination_stage),
        )
    )
    trip = result.scalars().first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.post("/activate", response_model=TripResponse, status_code=201)
async def activate_trip(
    payload: TripActivateRequest,
    current_user: User = Depends(requires_permission("manage_trips")),
    db: AsyncSession = Depends(get_db),
):
    matatu_result = await db.execute(select(Matatu).where(Matatu.id == payload.matatu_id))
    matatu = matatu_result.scalars().first()
    if not matatu:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    enforce_own_sacco(current_user, matatu.sacco_id, "You can only activate trips for your own Sacco's vehicles.")

    if payload.origin_stage_id == payload.destination_stage_id:
        raise HTTPException(status_code=400, detail="Origin and destination must be different stages.")
    for stage_id in (payload.origin_stage_id, payload.destination_stage_id):
        stage_result = await db.execute(select(Stage).where(Stage.id == stage_id))
        if not stage_result.scalars().first():
            raise HTTPException(status_code=404, detail="Stage not found")

    # Only one active trip per vehicle — superseding an existing QUEUED/
    # IN_PROGRESS trip (e.g. crew changed their mind before departing).
    existing_result = await db.execute(
        select(Trip).where(Trip.matatu_id == payload.matatu_id, Trip.status.in_(ACTIVE_STATUSES))
    )
    for old_trip in existing_result.scalars().all():
        old_trip.status = "CANCELLED"
        old_trip.ended_at = datetime.datetime.now(datetime.timezone.utc)

    trip = Trip(
        id=f"trip-{uuid.uuid4().hex[:10]}",
        matatu_id=payload.matatu_id,
        route_id=matatu.route_id,
        origin_stage_id=payload.origin_stage_id,
        destination_stage_id=payload.destination_stage_id,
        started_by=current_user.id,
        status="QUEUED",
        started_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(trip)
    await db.commit()
    return _to_response(await _load_trip(db, trip.id))


@router.post("/{trip_id}/depart", response_model=TripResponse)
async def depart_trip(
    trip_id: str,
    current_user: User = Depends(requires_permission("manage_trips")),
    db: AsyncSession = Depends(get_db),
):
    trip = await _load_trip(db, trip_id)
    enforce_own_sacco(current_user, trip.matatu.sacco_id, "You can only manage trips for your own Sacco's vehicles.")
    if trip.status != "QUEUED":
        raise HTTPException(status_code=400, detail=f"Trip is {trip.status}, not QUEUED.")
    trip.status = "IN_PROGRESS"
    trip.departed_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()
    return _to_response(await _load_trip(db, trip.id))


@router.post("/{trip_id}/complete", response_model=TripResponse)
async def complete_trip(
    trip_id: str,
    payload: TripCompleteRequest = TripCompleteRequest(),
    current_user: User = Depends(requires_permission("manage_trips")),
    db: AsyncSession = Depends(get_db),
):
    trip = await _load_trip(db, trip_id)
    enforce_own_sacco(current_user, trip.matatu.sacco_id, "You can only manage trips for your own Sacco's vehicles.")
    if trip.status not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Trip is already {trip.status}.")

    if payload.passenger_count is not None:
        # Generous upper bound (not just capacity) — a single trip can span
        # multiple boarding/alighting cycles across several stages on a
        # long route, so total riders carried can genuinely exceed seat
        # count. This only catches an obvious fat-fingered entry, not a
        # legitimately busy trip.
        max_plausible = max(trip.matatu.capacity, 14) * 5
        if payload.passenger_count < 0 or payload.passenger_count > max_plausible:
            raise HTTPException(
                status_code=400,
                detail=f"That passenger count doesn't look right for this vehicle — check the number.",
            )
        trip.passenger_count = payload.passenger_count

    trip.status = "COMPLETED"
    trip.ended_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()
    return _to_response(await _load_trip(db, trip.id))


@router.get("/active", response_model=TripResponse | None)
async def get_active_trip(
    matatu_id: str = Query(...),
    current_user: User = Depends(requires_permission("manage_trips")),
    db: AsyncSession = Depends(get_db),
):
    """The vehicle's current QUEUED/IN_PROGRESS trip, if any — what the crew
    dashboard polls to know whether "Activate Trip" or the queue/departure
    controls should show."""
    result = await db.execute(
        select(Trip)
        .where(Trip.matatu_id == matatu_id, Trip.status.in_(ACTIVE_STATUSES))
        .order_by(Trip.started_at.desc())
        .options(
            selectinload(Trip.matatu), selectinload(Trip.route),
            selectinload(Trip.origin_stage), selectinload(Trip.destination_stage),
        )
    )
    trip = result.scalars().first()
    if not trip:
        return None
    enforce_own_sacco(current_user, trip.matatu.sacco_id, "You can only view trips for your own Sacco's vehicles.")
    return _to_response(trip)


@router.get("/queue", response_model=QueueStatusResponse)
async def get_queue_status(
    matatu_id: str = Query(...),
    current_user: User = Depends(requires_permission("manage_trips")),
    db: AsyncSession = Depends(get_db),
):
    """Non-technical queue readout for one vehicle's own active trip: "n
    vehicles before you that have not picked" (QUEUED, same stage+route,
    older start time — FIFO) plus the total vehicles already moving on the
    route, across every Sacco, not just this vehicle's own fleet."""
    my_trip_result = await db.execute(
        select(Trip).where(Trip.matatu_id == matatu_id, Trip.status.in_(ACTIVE_STATUSES))
        .options(selectinload(Trip.matatu))
    )
    my_trip = my_trip_result.scalars().first()
    if not my_trip:
        return QueueStatusResponse(queued_at_stage=0, active_on_route=0)
    enforce_own_sacco(current_user, my_trip.matatu.sacco_id, "You can only view your own Sacco's vehicles.")

    queued_result = await db.execute(
        select(Trip.id, Trip.started_at)
        .where(
            Trip.route_id == my_trip.route_id,
            Trip.origin_stage_id == my_trip.origin_stage_id,
            Trip.status == "QUEUED",
        )
        .order_by(Trip.started_at.asc())
    )
    queued_rows = queued_result.all()
    queued_at_stage = len(queued_rows)

    position = None
    vehicles_ahead = None
    if my_trip.status == "QUEUED":
        for idx, (trip_id, _started_at) in enumerate(queued_rows, start=1):
            if trip_id == my_trip.id:
                position = idx
                vehicles_ahead = idx - 1
                break

    active_count_result = await db.execute(
        select(func.count(Trip.id)).where(Trip.route_id == my_trip.route_id, Trip.status == "IN_PROGRESS")
    )
    active_on_route = active_count_result.scalar() or 0

    return QueueStatusResponse(
        my_trip_id=my_trip.id,
        position=position,
        vehicles_ahead=vehicles_ahead,
        queued_at_stage=queued_at_stage,
        active_on_route=active_on_route,
    )
