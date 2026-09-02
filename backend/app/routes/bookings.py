import datetime
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Booking, Matatu, Route, User
from app.schemas import BookingCreate, BookingResponse, BookingStatusUpdate
from app.auth import get_current_user, requires_permission
from app.events import dispatcher
from app.audit import stage_audit_log
from app.abac import enforce_own_record, enforce_own_sacco, sacco_scope_query, is_own_record
from app.rate_limit import limiter
from app import ops_limits
from app.idempotency import IdempotencyContext, idempotency

router = APIRouter(prefix="/api/bookings", tags=["Passenger Bookings"])

def _to_response(booking: Booking) -> BookingResponse:
    return BookingResponse(
        id=booking.id,
        matatu_id=booking.matatu_id,
        route_id=booking.route_id,
        passenger_name=booking.passenger_name,
        phone=booking.phone,
        stage_name=booking.stage_name,
        seat_numbers=[int(s) for s in booking.seat_numbers.split(",") if s],
        fare_kes=booking.fare_kes,
        status=booking.status,
        booked_at=booking.booked_at,
        reg_number=booking.matatu.reg_number if booking.matatu else None,
        route_name=booking.route.name if booking.route else None,
    )

@router.get("/matatu/{matatu_id}/taken-seats", response_model=List[int])
async def get_taken_seats(
    matatu_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns seat numbers currently held by CONFIRMED bookings for a matatu."""
    result = await db.execute(
        select(Booking).where(Booking.matatu_id == matatu_id, Booking.status == "CONFIRMED")
    )
    taken: List[int] = []
    for b in result.scalars().all():
        taken.extend(int(s) for s in b.seat_numbers.split(",") if s)
    return taken

@router.get("", response_model=List[BookingResponse])
async def get_bookings(
    matatu_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Booking).options(selectinload(Booking.matatu), selectinload(Booking.route))
    if current_user.role == "PASSENGER":
        query = query.where(Booking.passenger_user_id == current_user.id)
    elif current_user.role in ("SACCO_OPERATOR", "CREW"):
        query = query.join(Matatu, Matatu.id == Booking.matatu_id)
        query = sacco_scope_query(current_user, query, Matatu.sacco_id)

    if matatu_id:
        query = query.where(Booking.matatu_id == matatu_id)

    result = await db.execute(query)
    return [_to_response(b) for b in result.scalars().all()]

@router.get("/{booking_id}", response_model=BookingResponse)
async def get_booking(
    booking_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.matatu), selectinload(Booking.route))
        .where(Booking.id == booking_id)
    )
    booking = result.scalars().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    enforce_own_record(current_user, booking.passenger_user_id, "This ticket does not belong to you")
    enforce_own_sacco(current_user, booking.matatu.sacco_id, "This ticket belongs to another Sacco's vehicle")

    return _to_response(booking)

@router.patch("/{booking_id}/status", response_model=BookingResponse)
async def update_booking_status(
    booking_id: str,
    payload: BookingStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.rbac import can

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.matatu), selectinload(Booking.route))
        .where(Booking.id == booking_id)
    )
    booking = result.scalars().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    new_status = payload.status.upper().strip()
    if new_status not in ("CONFIRMED", "USED", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Invalid status value")

    # Two distinct grants: Admin/Crew managing tickets on their vehicle, or a
    # passenger cancelling their own still-pending booking.
    is_ticket_manager = can(current_user.role, "update_booking_status")
    is_own_cancellation = (
        new_status == "CANCELLED"
        and can(current_user.role, "cancel_own_booking")
        and is_own_record(current_user, booking.passenger_user_id)
    )
    if not (is_ticket_manager or is_own_cancellation):
        raise HTTPException(status_code=403, detail="You do not have permission to update this booking.")

    enforce_own_sacco(current_user, booking.matatu.sacco_id, "This ticket belongs to another Sacco's vehicle")

    if is_own_cancellation and booking.status != "CONFIRMED":
        raise HTTPException(status_code=400, detail="Only a confirmed, upcoming booking can be cancelled.")

    old_status = booking.status
    if old_status != new_status:
        booking.status = new_status
        stage_audit_log(
            db, resource_type="booking", resource_id=booking.id, action="STATUS_CHANGE",
            user_id=current_user.id, old_values={"status": old_status}, new_values={"status": new_status},
        )
        await db.commit()

        dispatcher.dispatch("BOOKING_STATUS_CHANGED", {
            "booking_id": booking.id,
            "matatu_id": booking.matatu_id,
            "sacco_id": booking.matatu.sacco_id,
            "old_status": old_status,
            "new_status": new_status,
            "user_id": current_user.id,
        })

    return _to_response(booking)

@router.post("", response_model=BookingResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(ops_limits.limit_callable("bookings_create"))
async def create_booking(
    request: Request,
    payload: BookingCreate,
    current_user: User = Depends(requires_permission("book_ticket")),
    db: AsyncSession = Depends(get_db),
    idem: IdempotencyContext = Depends(idempotency),
):
    # Replay protection (app/idempotency.py). A passenger on a flaky mobile
    # connection whose request times out will retry, and without this the
    # retry books and charges for a second set of seats. Opt-in per call:
    # a client that sends no Idempotency-Key behaves exactly as before.
    replayed = await idem.replay()
    if replayed is not None:
        return replayed

    matatu_result = await db.execute(select(Matatu).where(Matatu.id == payload.matatu_id))
    matatu = matatu_result.scalars().first()
    if not matatu:
        raise HTTPException(status_code=404, detail="Matatu not found")
    if matatu.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="This vehicle is not currently in active service")

    route_result = await db.execute(select(Route).where(Route.id == payload.route_id))
    route = route_result.scalars().first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    if not payload.seat_numbers:
        raise HTTPException(status_code=400, detail="At least one seat must be selected")

    # Prevent double-booking of already-taken seats
    existing_result = await db.execute(
        select(Booking).where(Booking.matatu_id == payload.matatu_id, Booking.status == "CONFIRMED")
    )
    taken_seats = set()
    for b in existing_result.scalars().all():
        taken_seats.update(int(s) for s in b.seat_numbers.split(",") if s)
    conflicts = taken_seats.intersection(payload.seat_numbers)
    if conflicts:
        raise HTTPException(status_code=409, detail=f"Seat(s) {sorted(conflicts)} already booked")

    booking_id = f"PASS-{uuid.uuid4().hex[:10].upper()}"
    new_booking = Booking(
        id=booking_id,
        matatu_id=payload.matatu_id,
        route_id=payload.route_id,
        passenger_user_id=current_user.id,
        passenger_name=payload.passenger_name.strip(),
        phone=payload.phone.strip(),
        stage_name=payload.stage_name,
        seat_numbers=",".join(str(s) for s in payload.seat_numbers),
        fare_kes=route.fare_kes * len(payload.seat_numbers),
        status="CONFIRMED",
        booked_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(new_booking)
    await db.commit()

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.matatu), selectinload(Booking.route))
        .where(Booking.id == booking_id)
    )
    saved = result.scalars().first()

    dispatcher.dispatch("BOOKING_CREATED", {
        "booking_id": saved.id,
        "matatu_id": saved.matatu_id,
        "reg_number": matatu.reg_number,
        "sacco_id": matatu.sacco_id,
        "passenger_name": saved.passenger_name,
        "seat_numbers": payload.seat_numbers,
        "fare_kes": saved.fare_kes,
        "stage_name": saved.stage_name,
        "user_id": current_user.id,
    })

    return await idem.record(_to_response(saved).model_dump(mode="json"))
