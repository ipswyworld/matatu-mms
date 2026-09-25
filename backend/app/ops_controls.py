"""
System-wide operational controls (Ops Console Rebuild Spec §21.3, Critical
tier): maintenance mode and feature kill switches.

Distinct from feature flags on purpose. A feature flag is a product
decision — "is this capability on for this environment" — and lives in the
FeatureFlag table with its own CRUD. These are incident levers: they exist
to shed load or take the system out of service in a hurry, they are
Critical-classified, and they require re-authentication to change.

Same storage pattern as app/ops_limits.py, for the same reasons: Postgres
is the source of truth so a control survives a Redis flush and is audited;
Redis mirrors it so every replica converges; a module-level dict is the
read path because the request middleware that enforces maintenance mode
runs on every request and cannot await a lookup.
"""
import asyncio
import json
import logging
from typing import Dict, List, Optional

logger = logging.getLogger("app.ops_controls")

REDIS_KEY = "ops:system_controls"
REFRESH_INTERVAL_SECONDS = 5

MAINTENANCE_KEY = "maintenance_mode"

# A separate key from MAINTENANCE_KEY on purpose: this announces an
# upcoming window (Ops Console Rebuild Spec's Phase 8 item) without
# actually taking the system down — turning maintenance mode on/off stays
# the manual, Critical, re-auth-gated action it already is. An announcement
# can exist with no maintenance mode active yet ("this Saturday, 2-4am"),
# and stays informational even while it's happening — it never triggers
# MAINTENANCE_KEY itself.
ANNOUNCEMENT_KEY = "maintenance_announcement"

# Scope decides who a maintenance window actually stops. Defaulting to
# "public" rather than "all" is deliberate: enforcement officers and county
# staff frequently need to keep working through an incident that only
# affects passenger-facing traffic, and a maintenance switch that
# needlessly locks out the people handling the incident is worse than no
# switch. "all" stays available for a genuine full stop.
MAINTENANCE_SCOPES = ("public", "all")

# Kill switches are declared here rather than created ad hoc, so the
# console can list what exists and each one names what it actually turns
# off. An unknown switch is rejected instead of silently stored.
KILL_SWITCHES: Dict[str, str] = {
    "live_tracking": "Live vehicle tracking WebSocket fan-out and position queries.",
    "map_tiles": "Map rendering and third-party tile/traffic requests.",
    "public_booking": "New seat bookings from the public app.",
    "webhook_delivery": "Outbound webhook delivery to Sacco partner endpoints.",
    "report_generation": "On-demand report generation jobs.",
}

# {key: {"enabled": bool, "value": dict}}
_cache: Dict[str, dict] = {}
_refresh_task: Optional[asyncio.Task] = None


def _entry(key: str) -> dict:
    return _cache.get(key) or {"enabled": False, "value": {}}


def is_maintenance_active() -> bool:
    return bool(_entry(MAINTENANCE_KEY)["enabled"])


def maintenance_scope() -> str:
    return _entry(MAINTENANCE_KEY)["value"].get("scope", "public")


def maintenance_message() -> str:
    return _entry(MAINTENANCE_KEY)["value"].get(
        "message", "The system is temporarily unavailable for maintenance. Please try again shortly."
    )


def get_announcement() -> Optional[dict]:
    """The current maintenance-window announcement, or None if cleared.
    Enabled/disabled here just means "does an announcement exist" — it has
    nothing to do with MAINTENANCE_KEY's own enabled state."""
    entry = _entry(ANNOUNCEMENT_KEY)
    if not entry["enabled"]:
        return None
    return entry["value"]


def is_killed(feature: str) -> bool:
    """Call-site check for a kill switch. Unknown features are never
    considered killed, so a typo disables nothing rather than silently
    turning a feature off."""
    if feature not in KILL_SWITCHES:
        return False
    return bool(_entry(f"killswitch:{feature}")["enabled"])


def snapshot() -> dict:
    return {
        "maintenance": {
            "enabled": is_maintenance_active(),
            "scope": maintenance_scope(),
            "message": maintenance_message(),
            "scopes": list(MAINTENANCE_SCOPES),
        },
        "announcement": get_announcement(),
        "killSwitches": [
            {
                "feature": feature,
                "description": description,
                "killed": is_killed(feature),
            }
            for feature, description in KILL_SWITCHES.items()
        ],
    }


def apply_local(key: str, enabled: bool, value: Optional[dict] = None) -> None:
    _cache[key] = {"enabled": enabled, "value": value or {}}


async def publish_to_redis() -> None:
    from app.realtime import get_redis
    try:
        r = await get_redis()
        await r.set(REDIS_KEY, json.dumps(_cache))
    except Exception as e:
        # Postgres already holds the truth; the next refresh reconciles.
        logger.warning("Could not mirror system controls to Redis: %s", e)


async def load_from_db(db) -> None:
    from sqlalchemy.future import select
    from app.models import SystemControl
    try:
        result = await db.execute(select(SystemControl))
        for row in result.scalars().all():
            try:
                value = json.loads(row.value) if row.value else {}
            except (TypeError, ValueError):
                value = {}
            _cache[row.key] = {"enabled": bool(row.enabled), "value": value}
    except Exception as e:
        logger.warning("Could not load system controls from DB: %s", e)


async def _refresh_loop() -> None:
    from app.realtime import get_redis
    global _cache
    while True:
        try:
            await asyncio.sleep(REFRESH_INTERVAL_SECONDS)
            r = await get_redis()
            raw = await r.get(REDIS_KEY)
            if raw:
                _cache = json.loads(raw)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug("System controls refresh skipped: %s", e)


def start_refresh_task() -> None:
    global _refresh_task
    if _refresh_task is None:
        _refresh_task = asyncio.create_task(_refresh_loop())


def stop_refresh_task() -> None:
    global _refresh_task
    if _refresh_task is not None:
        _refresh_task.cancel()
        _refresh_task = None


# Paths that stay reachable during maintenance regardless of scope.
#
# The governing rule is that maintenance mode must never lock out the
# console used to turn it off. That means exempting not just /api/control
# but *every endpoint the ops console reads to render*, because a console
# whose pages crash is just as unusable as one that is unreachable.
#
# This was found the hard way in testing: exempting only /api/control left
# /api/feature-flags and /api/jobs/queue blocked, which blanked the Config
# and Jobs pages the moment maintenance was enabled — including the very
# panel holding the disable button.
#
# Anything added to the ops console's data layer (matatu-mms-ops/lib/data.ts)
# must be added here too.
MAINTENANCE_EXEMPT_PREFIXES = (
    "/healthz",
    "/health",
    "/metrics",
    # The public status page must stay reachable especially *during* a
    # maintenance window — that's the one time anyone actually needs it.
    "/api/status",
    # The control plane itself.
    "/api/control",
    # Everything matatu-mms-ops/lib/data.ts reads.
    "/api/system/health",
    "/api/audit-logs",
    "/api/users",
    "/api/feature-flags",
    "/api/jobs",
)

# Under "public" scope these stay up so staff can still authenticate and
# work the incident.
STAFF_PATH_PREFIXES = (
    "/api/auth",
    "/api/dashboard",
    "/api/enforcement-cases",
    "/api/fines",
    "/api/users",
    "/api/audit-logs",
    "/api/beats",
    "/api/crimes",
)


def blocks_request(path: str) -> bool:
    """Whether maintenance mode should reject this request."""
    if not is_maintenance_active():
        return False
    if any(path.startswith(p) for p in MAINTENANCE_EXEMPT_PREFIXES):
        return False
    if maintenance_scope() == "public" and any(path.startswith(p) for p in STAFF_PATH_PREFIXES):
        return False
    return True
