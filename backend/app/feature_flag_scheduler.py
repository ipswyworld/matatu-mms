"""
Scheduled feature-flag toggles (Ops Console Rebuild Spec's Phase 5 item) —
an ARQ cron that flips a flag when its scheduled_enable_at/
scheduled_disable_at comes due. The flag CRUD itself
(app/routes/feature_flags.py) only ever sets these columns; this module is
the only thing that ever acts on them.

Audited as user_id="system" — AuditLog.user_id has no foreign key (unlike
FeatureFlag.updated_by, which does, so that stays NULL for a scheduled
flip rather than pointing at whoever originally scheduled it hours or days
earlier).
"""
import datetime
import logging

from sqlalchemy import select

from app.audit import stage_audit_log
from app.database import AsyncSessionLocal
from app.models import FeatureFlag

logger = logging.getLogger("app.feature_flag_scheduler")

SYSTEM_ACTOR = "system"


async def run_scheduled_flag_flips(ctx) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    flipped = []

    async with AsyncSessionLocal() as db:
        due_enable = (
            await db.execute(
                select(FeatureFlag).where(
                    FeatureFlag.scheduled_enable_at.isnot(None),
                    FeatureFlag.scheduled_enable_at <= now,
                )
            )
        ).scalars().all()
        for flag in due_enable:
            was_enabled = flag.enabled
            flag.enabled = True
            flag.scheduled_enable_at = None
            flag.updated_at = now
            stage_audit_log(
                db, resource_type="feature_flag", resource_id=flag.key, action="SCHEDULED_ENABLE",
                user_id=SYSTEM_ACTOR,
                old_values={"enabled": was_enabled},
                new_values={"enabled": True},
            )
            flipped.append(f"{flag.key}=on")

        due_disable = (
            await db.execute(
                select(FeatureFlag).where(
                    FeatureFlag.scheduled_disable_at.isnot(None),
                    FeatureFlag.scheduled_disable_at <= now,
                )
            )
        ).scalars().all()
        for flag in due_disable:
            was_enabled = flag.enabled
            flag.enabled = False
            flag.scheduled_disable_at = None
            flag.updated_at = now
            stage_audit_log(
                db, resource_type="feature_flag", resource_id=flag.key, action="SCHEDULED_DISABLE",
                user_id=SYSTEM_ACTOR,
                old_values={"enabled": was_enabled},
                new_values={"enabled": False},
            )
            flipped.append(f"{flag.key}=off")

        await db.commit()

    if flipped:
        logger.info("Scheduled feature-flag flips applied: %s", ", ".join(flipped))
    return f"flipped {len(flipped)} flag(s)"
