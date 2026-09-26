"""
One-transfer journey bookings (Phase 9, #6 of the journey-planning plan) — a
thin grouping record over two independently-created bookings (each a normal
Booking or ScheduledBooking row, own seat assignment, own audit trail, own
dispatch event). This file only ever creates/looks up the grouping row
itself; it never touches Booking/ScheduledBooking internals. See
JourneyBooking's own docstring in app/models.py for why a separate table.
"""
import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import JourneyBooking, User
from app.schemas import JourneyBookingCreate, JourneyBookingResponse
from app.auth import requires_permission

router = APIRouter(prefix="/api/journey-bookings", tags=["Journey Bookings"])


def _to_response(jb: JourneyBooking) -> JourneyBookingResponse:
    return JourneyBookingResponse(
        id=jb.id,
        leg1_booking_id=jb.leg1_booking_id,
        leg1_booking_type=jb.leg1_booking_type,
        leg2_booking_id=jb.leg2_booking_id,
        leg2_booking_type=jb.leg2_booking_type,
        transfer_stage_id=jb.transfer_stage_id,
        transfer_stage_name=jb.transfer_stage.name if jb.transfer_stage else None,
        created_at=jb.created_at,
    )


@router.post("", response_model=JourneyBookingResponse, status_code=201)
async def create_journey_booking(
    payload: JourneyBookingCreate,
    current_user: User = Depends(requires_permission("book_ticket")),
    db: AsyncSession = Depends(get_db),
):
    if payload.leg1_booking_type not in ("instant", "scheduled") or payload.leg2_booking_type not in ("instant", "scheduled"):
        raise HTTPException(status_code=400, detail="booking_type must be 'instant' or 'scheduled'")

    jb = JourneyBooking(
        id=f"JOURNEY-{uuid.uuid4().hex[:10].upper()}",
        passenger_user_id=current_user.id,
        leg1_booking_id=payload.leg1_booking_id,
        leg1_booking_type=payload.leg1_booking_type,
        leg2_booking_id=payload.leg2_booking_id,
        leg2_booking_type=payload.leg2_booking_type,
        transfer_stage_id=payload.transfer_stage_id,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(jb)
    await db.commit()

    result = await db.execute(
        select(JourneyBooking).options(selectinload(JourneyBooking.transfer_stage)).where(JourneyBooking.id == jb.id)
    )
    return _to_response(result.scalars().first())


@router.get("/{journey_booking_id}", response_model=JourneyBookingResponse)
async def get_journey_booking(
    journey_booking_id: str,
    current_user: User = Depends(requires_permission("book_ticket")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(JourneyBooking)
        .options(selectinload(JourneyBooking.transfer_stage))
        .where(JourneyBooking.id == journey_booking_id)
    )
    jb = result.scalars().first()
    if not jb:
        raise HTTPException(status_code=404, detail="Journey booking not found")
    if jb.passenger_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your journey booking")
    return _to_response(jb)
