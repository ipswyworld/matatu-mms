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

from app.audit import stage_audit_log
from app.database import AsyncSessionLocal
from app.models import ScheduledBooking
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

        await db.commit()

    if reminded or confirmed:
        logger.info(
            "Scheduled-booking sweep: %d reminder(s) sent, %d auto-confirmed",
            len(reminded), len(confirmed),
        )
    return f"reminded {len(reminded)}, confirmed {len(confirmed)}"
