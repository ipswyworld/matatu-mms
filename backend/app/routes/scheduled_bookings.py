"""
Scheduled advance bookings (Phase 4 of the journey-planning plan) — a
passenger reserves a seat for a future departure rather than boarding a
vehicle right now. Genuinely different lifecycle from Booking's closed
CONFIRMED/USED/CANCELLED (see ScheduledBooking's own docstring in
app/models.py for why this is a separate table, not a column on Booking).

Reminders, no-show release, and reassignment are handled by the ARQ cron in
app/scheduled_booking_scheduler.py, not by this route module — this file
only ever handles the request/response side of the lifecycle a human
directly triggers (create, cancel, look up).
"""
import datetime
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ScheduledBooking, Route, Matatu, Stage, User
from app.schemas import ScheduledBookingCreate, ScheduledBookingResponse, ScheduledBookingStatusUpdate
from app.auth import requires_permission, get_current_user
from app.events import dispatcher
from app.audit import stage_audit_log
from app.abac import sacco_scope_query

router = APIRouter(prefix="/api/scheduled-bookings", tags=["Scheduled Bookings"])


def _to_response(sb: ScheduledBooking) -> ScheduledBookingResponse:
    return ScheduledBookingResponse(
        id=sb.id,
        route_id=sb.route_id,
        matatu_id=sb.matatu_id,
        passenger_name=sb.passenger_name,
        phone=sb.phone,
        origin_stage_id=sb.origin_stage_id,
        destination_stage_id=sb.destination_stage_id,
        scheduled_departure=sb.scheduled_departure,
        seat_numbers=[int(s) for s in sb.seat_numbers.split(",") if s],
        fare_kes=sb.fare_kes,
        status=sb.status,
        is_recurring=sb.is_recurring,
        accessibility_flag=sb.accessibility_flag,
        trusted_contact_phone=sb.trusted_contact_phone,
        created_at=sb.created_at,
        route_name=sb.route.name if sb.route else None,
        route_code=sb.route.code if sb.route else None,
        origin_stage_name=sb.origin_stage.name if sb.origin_stage else None,
        destination_stage_name=sb.destination_stage.name if sb.destination_stage else None,
        reg_number=sb.matatu.reg_number if sb.matatu else None,
    )


@router.post("", response_model=ScheduledBookingResponse, status_code=201)
async def create_scheduled_booking(
    payload: ScheduledBookingCreate,
    current_user: User = Depends(requires_permission("book_scheduled_ticket")),
    db: AsyncSession = Depends(get_db),
):
    if payload.scheduled_departure <= datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(status_code=400, detail="Scheduled departure must be in the future")
    if not payload.seat_numbers:
        raise HTTPException(status_code=400, detail="At least one seat must be requested")

    route = (await db.execute(select(Route).where(Route.id == payload.route_id))).scalars().first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    origin = (await db.execute(select(Stage).where(Stage.id == payload.origin_stage_id))).scalars().first()
    if not origin:
        raise HTTPException(status_code=404, detail="Origin stage not found")
    if payload.destination_stage_id:
        dest = (await db.execute(select(Stage).where(Stage.id == payload.destination_stage_id))).scalars().first()
        if not dest:
            raise HTTPException(status_code=404, detail="Destination stage not found")

    booking_id = f"SCHED-{uuid.uuid4().hex[:10].upper()}"
    now = datetime.datetime.now(datetime.timezone.utc)
    new_sb = ScheduledBooking(
        id=booking_id,
        route_id=payload.route_id,
        matatu_id=None,  # assigned later — the whole point of booking ahead of an instant match
        passenger_user_id=current_user.id,
        passenger_name=payload.passenger_name.strip(),
        phone=payload.phone.strip(),
        origin_stage_id=payload.origin_stage_id,
        destination_stage_id=payload.destination_stage_id,
        scheduled_departure=payload.scheduled_departure,
        seat_numbers=",".join(str(s) for s in payload.seat_numbers),
        fare_kes=route.fare_kes * len(payload.seat_numbers),
        status="PENDING",
        accessibility_flag=payload.accessibility_flag,
        trusted_contact_phone=payload.trusted_contact_phone,
        created_at=now,
        updated_at=now,
    )
    db.add(new_sb)
    stage_audit_log(
        db, resource_type="scheduled_booking", resource_id=booking_id, action="CREATE",
        user_id=current_user.id, old_values=None,
        new_values={"route_id": payload.route_id, "scheduled_departure": payload.scheduled_departure.isoformat()},
    )
    await db.commit()

    result = await db.execute(
        select(ScheduledBooking)
        .options(selectinload(ScheduledBooking.route), selectinload(ScheduledBooking.matatu),
                 selectinload(ScheduledBooking.origin_stage), selectinload(ScheduledBooking.destination_stage))
        .where(ScheduledBooking.id == booking_id)
    )
    saved = result.scalars().first()

    dispatcher.dispatch("SCHEDULED_BOOKING_CREATED", {
        "scheduled_booking_id": saved.id,
        "route_id": saved.route_id,
        "passenger_name": saved.passenger_name,
        "scheduled_departure": saved.scheduled_departure.isoformat(),
        "user_id": current_user.id,
    })

    return _to_response(saved)


@router.get("", response_model=List[ScheduledBookingResponse])
async def get_scheduled_bookings(
    matatu_id: str | None = None,
    current_user: User = Depends(requires_permission("view_scheduled_bookings")),
    db: AsyncSession = Depends(get_db),
):
    """Crew's per-vehicle view and sacco's fleet-wide view, same scoping
    pattern as bookings.py's get_bookings: CREW/SACCO_OPERATOR only ever see
    their own sacco's vehicles (via the Matatu join), enforced the same way
    for both roles here. A scheduled booking with no matatu_id assigned yet
    can't appear in either scoped view - there's no sacco/crew to scope it
    to until a vehicle is actually assigned."""
    query = (
        select(ScheduledBooking)
        .options(selectinload(ScheduledBooking.route), selectinload(ScheduledBooking.matatu),
                 selectinload(ScheduledBooking.origin_stage), selectinload(ScheduledBooking.destination_stage))
    )
    if current_user.role in ("SACCO_OPERATOR", "CREW"):
        query = query.join(Matatu, Matatu.id == ScheduledBooking.matatu_id)
        query = sacco_scope_query(current_user, query, Matatu.sacco_id)

    if matatu_id:
        query = query.where(ScheduledBooking.matatu_id == matatu_id)

    query = query.order_by(ScheduledBooking.scheduled_departure)
    result = await db.execute(query)
    return [_to_response(sb) for sb in result.scalars().all()]


@router.get("/mine", response_model=List[ScheduledBookingResponse])
async def get_my_scheduled_bookings(
    current_user: User = Depends(requires_permission("view_scheduled_bookings")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ScheduledBooking)
        .options(selectinload(ScheduledBooking.route), selectinload(ScheduledBooking.matatu),
                 selectinload(ScheduledBooking.origin_stage), selectinload(ScheduledBooking.destination_stage))
        .where(ScheduledBooking.passenger_user_id == current_user.id)
        .order_by(ScheduledBooking.scheduled_departure)
    )
    return [_to_response(sb) for sb in result.scalars().all()]


@router.get("/{scheduled_booking_id}", response_model=ScheduledBookingResponse)
async def get_scheduled_booking(
    scheduled_booking_id: str,
    current_user: User = Depends(requires_permission("view_scheduled_bookings")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ScheduledBooking)
        .options(selectinload(ScheduledBooking.route), selectinload(ScheduledBooking.matatu),
                 selectinload(ScheduledBooking.origin_stage), selectinload(ScheduledBooking.destination_stage))
        .where(ScheduledBooking.id == scheduled_booking_id)
    )
    sb = result.scalars().first()
    if not sb:
        raise HTTPException(status_code=404, detail="Scheduled booking not found")
    # A passenger may only look up their own; staff/crew/sacco roles (all
    # holding view_scheduled_bookings for their own operational reasons)
    # aren't restricted here, matching get_bookings' equivalent own-record
    # check in routes/bookings.py.
    if current_user.role == "PASSENGER" and sb.passenger_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your scheduled booking")
    return _to_response(sb)


@router.patch("/{scheduled_booking_id}/status", response_model=ScheduledBookingResponse)
async def update_scheduled_booking_status(
    scheduled_booking_id: str,
    payload: ScheduledBookingStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledBooking).where(ScheduledBooking.id == scheduled_booking_id))
    sb = result.scalars().first()
    if not sb:
        raise HTTPException(status_code=404, detail="Scheduled booking not found")
    if current_user.role == "PASSENGER":
        if sb.passenger_user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not your scheduled booking")
        if payload.status != "CANCELLED":
            raise HTTPException(status_code=403, detail="Passengers may only cancel a scheduled booking")

    old_status = sb.status
    sb.status = payload.status
    sb.updated_at = datetime.datetime.now(datetime.timezone.utc)
    if payload.status == "CONFIRMED" and not sb.grace_expires_at:
        # The grace window starts from confirmation, not from the original
        # request — "this is really happening" is the meaningful clock
        # start for no-show handling, not whenever it was first asked for.
        sb.grace_expires_at = sb.scheduled_departure + datetime.timedelta(minutes=sb.grace_period_minutes)

    stage_audit_log(
        db, resource_type="scheduled_booking", resource_id=sb.id, action="STATUS_CHANGE",
        user_id=current_user.id, old_values={"status": old_status}, new_values={"status": payload.status},
    )
    await db.commit()

    result = await db.execute(
        select(ScheduledBooking)
        .options(selectinload(ScheduledBooking.route), selectinload(ScheduledBooking.matatu),
                 selectinload(ScheduledBooking.origin_stage), selectinload(ScheduledBooking.destination_stage))
        .where(ScheduledBooking.id == scheduled_booking_id)
    )
    saved = result.scalars().first()
    dispatcher.dispatch("SCHEDULED_BOOKING_STATUS_CHANGED", {
        "scheduled_booking_id": saved.id, "old_status": old_status, "new_status": payload.status,
        "user_id": current_user.id,
    })
    return _to_response(saved)
