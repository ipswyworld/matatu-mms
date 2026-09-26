"""
Scheduled-booking sweep (Phase 4 of the journey-planning plan) — an ARQ
cron, modeled directly on app/feature_flag_scheduler.py's
run_scheduled_flag_flips, that acts on time-based state ScheduledBooking
rows carry. This phase's sweep does two things: sends a reminder
notification at REMINDER_LEAD_MINUTES before scheduled_departure, and
flips PENDING -> CONFIRMED once a booking is close enough to be "really
happening". No-show release and reassignment (Phase 6) extend this same
sweep rather than adding a second one.

Audited as user_id="system" for the same reason as the feature-flag
scheduler: AuditLog.user_id has no foreign key, so this never needs to
point at whoever originally made the booking hours or days earlier.
"""
import datetime
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import stage_audit_log
from app.database import AsyncSessionLocal
from app.models import Matatu, ScheduledBooking
from app.routes.notifications import notify_user

logger = logging.getLogger("app.scheduled_booking_scheduler")

SYSTEM_ACTOR = "system"

# How long before departure a reminder fires, and how long before departure
# a PENDING booking is treated as confirmed (no further action expected
# from the passenger, e.g. a payment step, in this system — pay-on-board
# means "confirmed" here just means "still on, not cancelled").
REMINDER_LEAD_MINUTES = 30
AUTO_CONFIRM_LEAD_MINUTES = 60


async def run_scheduled_booking_sweep(ctx) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    reminded = []
    confirmed = []

    async with AsyncSessionLocal() as db:
        reminder_cutoff = now + datetime.timedelta(minutes=REMINDER_LEAD_MINUTES)
        due_reminders = (
            await db.execute(
                select(ScheduledBooking).where(
                    ScheduledBooking.reminder_sent_at.is_(None),
                    ScheduledBooking.status.in_(["PENDING", "CONFIRMED"]),
                    ScheduledBooking.scheduled_departure <= reminder_cutoff,
                    ScheduledBooking.scheduled_departure > now,
                )
            )
        ).scalars().all()
        for sb in due_reminders:
            sb.reminder_sent_at = now
            await notify_user(
                sb.passenger_user_id,
                title="Your matatu departs soon",
                message=f"Your scheduled trip departs at {sb.scheduled_departure.strftime('%H:%M')} — head to your boarding stage.",
                level="info",
                type="SCHEDULED_TRIP_REMINDER",
                scheduled_booking_id=sb.id,
            )
            reminded.append(sb.id)

        confirm_cutoff = now + datetime.timedelta(minutes=AUTO_CONFIRM_LEAD_MINUTES)
        due_confirm = (
            await db.execute(
                select(ScheduledBooking).where(
                    ScheduledBooking.status == "PENDING",
                    ScheduledBooking.scheduled_departure <= confirm_cutoff,
                )
            )
        ).scalars().all()
        for sb in due_confirm:
            sb.status = "CONFIRMED"
            sb.updated_at = now
            sb.grace_expires_at = sb.scheduled_departure + datetime.timedelta(minutes=sb.grace_period_minutes)
            stage_audit_log(
                db, resource_type="scheduled_booking", resource_id=sb.id, action="AUTO_CONFIRM",
                user_id=SYSTEM_ACTOR, old_values={"status": "PENDING"}, new_values={"status": "CONFIRMED"},
            )
            confirmed.append(sb.id)

        # No-show release (Phase 6): a CONFIRMED booking whose grace window
        # has passed without the passenger boarding. BOARDED bookings are
        # never touched here — this only catches the ones nobody showed up
        # for. Releasing just means flipping status; nothing else in this
        # system holds a seat count against a ScheduledBooking specifically
        # (Booking's own taken-seats logic is separate), so there's no
        # inventory to give back beyond the status itself.
        due_no_show = (
            await db.execute(
                select(ScheduledBooking).where(
                    ScheduledBooking.status == "CONFIRMED",
                    ScheduledBooking.grace_expires_at.is_not(None),
                    ScheduledBooking.grace_expires_at <= now,
                )
            )
        ).scalars().all()
        no_shows = []
        for sb in due_no_show:
            sb.status = "NO_SHOW"
            sb.updated_at = now
            stage_audit_log(
                db, resource_type="scheduled_booking", resource_id=sb.id, action="NO_SHOW",
                user_id=SYSTEM_ACTOR, old_values={"status": "CONFIRMED"}, new_values={"status": "NO_SHOW"},
            )
            await notify_user(
                sb.passenger_user_id,
                title="Marked as a no-show",
                message="Your scheduled trip's grace period passed without boarding, so the seat has been released.",
                level="error",
                type="NO_SHOW_WARNING",
                scheduled_booking_id=sb.id,
            )
            no_shows.append(sb.id)

        await db.commit()

    if reminded or confirmed or no_shows:
        logger.info(
            "Scheduled-booking sweep: %d reminder(s) sent, %d auto-confirmed, %d no-show",
            len(reminded), len(confirmed), len(no_shows),
        )
    return f"reminded {len(reminded)}, confirmed {len(confirmed)}, no_show {len(no_shows)}"


async def reassign_scheduled_bookings_for_matatu(db: AsyncSession, matatu_id: str) -> int:
    """Called from routes/matatus.py's update_matatu_status when a vehicle
    goes out of service (FLAGGED/IMPOUNDED/DECOMMISSIONED) — event-driven,
    not just relying on the next cron tick, since a stranded passenger
    shouldn't wait up to 5 minutes to find out. For each affected PENDING/
    CONFIRMED scheduled booking: try to auto-match another ACTIVE matatu on
    the same route; if one exists, move the booking there and notify the
    passenger of the change. If none exists, flip to REASSIGNED (a terminal
    state distinct from CANCELLED — this wasn't the passenger's choice) and
    ask them to re-book. Uses the caller's own db/session and does NOT
    commit — routes/matatus.py commits once, in the same transaction as its
    own status-change write, so a failure partway through never leaves the
    matatu status changed without its dependent bookings handled.
    """
    affected = (
        await db.execute(
            select(ScheduledBooking).where(
                ScheduledBooking.matatu_id == matatu_id,
                ScheduledBooking.status.in_(["PENDING", "CONFIRMED"]),
            )
        )
    ).scalars().all()
    if not affected:
        return 0

    alternative = (
        await db.execute(
            select(Matatu).where(Matatu.route_id == affected[0].route_id, Matatu.status == "ACTIVE", Matatu.id != matatu_id)
        )
    ).scalars().first()

    now = datetime.datetime.now(datetime.timezone.utc)
    for sb in affected:
        sb.reassigned_from_matatu_id = matatu_id
        sb.updated_at = now
        if alternative:
            sb.matatu_id = alternative.id
            stage_audit_log(
                db, resource_type="scheduled_booking", resource_id=sb.id, action="REASSIGN_VEHICLE",
                user_id=SYSTEM_ACTOR, old_values={"matatu_id": matatu_id}, new_values={"matatu_id": alternative.id},
            )
            await notify_user(
                sb.passenger_user_id,
                title="Your matatu changed",
                message=f"Your original vehicle went out of service — you're now booked on {alternative.reg_number} for the same trip.",
                level="warning",
                type="REASSIGNMENT_ALERT",
                scheduled_booking_id=sb.id,
            )
        else:
            sb.status = "REASSIGNED"
            sb.matatu_id = None
            stage_audit_log(
                db, resource_type="scheduled_booking", resource_id=sb.id, action="REASSIGN_NO_ALTERNATIVE",
                user_id=SYSTEM_ACTOR, old_values={"status": "CONFIRMED", "matatu_id": matatu_id}, new_values={"status": "REASSIGNED"},
            )
            await notify_user(
                sb.passenger_user_id,
                title="Your matatu is out of service",
                message="No alternative vehicle is currently available on this route — please schedule a new trip.",
                level="error",
                type="REASSIGNMENT_ALERT",
                scheduled_booking_id=sb.id,
            )

    return len(affected)
