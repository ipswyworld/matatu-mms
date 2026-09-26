import datetime
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import Booking, CrewAssignment, Matatu, Route, TripRating, User
from app.schemas import TripRatingCreate, TripRatingResponse, PendingRatingResponse
from app.auth import get_current_user, requires_permission
from app.abac import enforce_own_sacco_operator_only

router = APIRouter(prefix="/api/trip-ratings", tags=["Trip Ratings"])


async def _resolve_crew(db: AsyncSession, matatu_id: str, at: datetime.datetime, crew_role: str) -> Optional[str]:
    """Who was working this vehicle at booking time. CrewAssignment has no
    DB constraint against two simultaneously-active rows of the same role
    on one vehicle (issue_crew_credentials doesn't revoke the prior one) —
    when more than one candidate overlaps the window, the most-recently-
    assigned one wins: deterministic, and matches the realistic case of an
    informal crew handoff that was never formally logged out."""
    result = await db.execute(
        select(CrewAssignment)
        .where(
            CrewAssignment.matatu_id == matatu_id,
            CrewAssignment.crew_role == crew_role,
            CrewAssignment.assigned_at <= at,
        )
        .order_by(CrewAssignment.assigned_at.desc())
    )
    candidates = result.scalars().all()
    for candidate in candidates:
        if candidate.unassigned_at is None or candidate.unassigned_at > at:
            return candidate.user_id
    return None


@router.get("/pending", response_model=List[PendingRatingResponse])
async def list_pending_ratings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """This passenger's USED bookings with no rating yet — drives the
    rating-prompt UI. Kept separate from PassengerReport/feedback, which is
    an unrelated enforcement-complaint channel."""
    result = await db.execute(
        select(Booking, Matatu.reg_number, Route.name)
        .join(Matatu, Matatu.id == Booking.matatu_id)
        .join(Route, Route.id == Booking.route_id)
        .outerjoin(TripRating, TripRating.booking_id == Booking.id)
        .where(
            Booking.passenger_user_id == current_user.id,
            Booking.status == "USED",
            TripRating.id.is_(None),
        )
        .order_by(Booking.booked_at.desc())
    )
    return [
        PendingRatingResponse(booking_id=b.id, reg_number=reg, route_name=route_name, booked_at=b.booked_at)
        for b, reg, route_name in result.all()
    ]


@router.post("", response_model=TripRatingResponse, status_code=status.HTTP_201_CREATED)
async def create_trip_rating(
    payload: TripRatingCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    booking_result = await db.execute(select(Booking).where(Booking.id == payload.booking_id))
    booking = booking_result.scalars().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.passenger_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only rate your own trips.")
    if booking.status != "USED":
        raise HTTPException(status_code=400, detail="Only completed trips can be rated.")

    existing = await db.execute(select(TripRating).where(TripRating.booking_id == payload.booking_id))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="This trip has already been rated.")

    matatu_result = await db.execute(select(Matatu).where(Matatu.id == booking.matatu_id))
    matatu = matatu_result.scalars().first()
    if not matatu:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    driver_id = await _resolve_crew(db, matatu.id, booking.booked_at, "DRIVER")
    conductor_id = await _resolve_crew(db, matatu.id, booking.booked_at, "CONDUCTOR")

    rating = TripRating(
        id=f"rate-{secrets.token_hex(4)}",
        booking_id=booking.id,
        matatu_id=matatu.id,
        sacco_id=matatu.sacco_id,
        driver_user_id=driver_id,
        conductor_user_id=conductor_id,
        rating=payload.rating,
        comment=payload.comment,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(rating)
    await db.commit()
    await db.refresh(rating)
    return rating


@router.get("/crew/{user_id}", response_model=List[TripRatingResponse])
async def list_crew_ratings(
    user_id: str,
    current_user: User = Depends(requires_permission("view_crew")),
    db: AsyncSession = Depends(get_db),
):
    """view_crew is held by both real staff (unrestricted) AND
    SACCO_OPERATOR/CREW (their own roster only, same as everywhere else
    view_crew is used in this codebase) — so a Sacco Operator/Crew caller is
    scoped to crew belonging to their own sacco, not requires_permission
    alone, which would otherwise let them look up any crew member
    system-wide."""
    if current_user.role in ("SACCO_OPERATOR", "CREW"):
        target = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
        if not target or target.sacco_id != current_user.sacco_id:
            raise HTTPException(status_code=403, detail="You can only view ratings for your own Sacco's crew.")

    result = await db.execute(
        select(TripRating).where(
            (TripRating.driver_user_id == user_id) | (TripRating.conductor_user_id == user_id)
        ).order_by(TripRating.created_at.desc())
    )
    return result.scalars().all()


@router.get("/sacco/{sacco_id}", response_model=List[TripRatingResponse])
async def list_sacco_ratings(
    sacco_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A Sacco Operator sees only their own operator's ratings (the point of
    ask #3 — this is the data feeding back to the operator); real staff see
    any sacco's. Scoped by role, not by the view_crew permission — SACCO_
    OPERATOR/CREW hold view_crew too (for their own roster), so checking
    that permission alone would incorrectly let one operator read another
    operator's ratings."""
    if current_user.role in ("SACCO_OPERATOR", "CREW"):
        enforce_own_sacco_operator_only(current_user, sacco_id)

    result = await db.execute(
        select(TripRating).where(TripRating.sacco_id == sacco_id).order_by(TripRating.created_at.desc())
    )
    return result.scalars().all()
