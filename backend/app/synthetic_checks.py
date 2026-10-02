"""
Synthetic uptime/latency checks — this backend hitting each frontend's own
/api/health on a schedule and recording the result (Ops Console Rebuild
Spec's Phase 4 operational-visibility item).

Honest about its own limit: this proves a check ran from inside this same
cluster, not true external network independence. A real third-party uptime
service (Pingdom, UptimeRobot, Better Stack, ...) would catch a cluster-wide
network partition that this cannot — that's an infra/billing decision
outside this codebase's scope, not something to fake here.
"""
import datetime
import logging
import time
from typing import List, NamedTuple, Optional

import httpx
from sqlalchemy import delete

from app.config import STAFF_APP_URL, PUBLIC_APP_URL, OPS_APP_URL
from app.database import AsyncSessionLocal
from app.models import SyntheticCheckResult

logger = logging.getLogger("app.synthetic_checks")

# Each app's own /api/health — the same lightweight, unauthenticated route
# every one of the three Next.js apps already exposes (confirmed present in
# each app's app/api/health directory), not a new endpoint invented for
# this.
_TARGETS = [
    ("staff-app", STAFF_APP_URL),
    ("public-app", PUBLIC_APP_URL),
    ("ops-console", OPS_APP_URL),
]

# Bounds table growth the same way WebhookLog and AuditLog are expected to
# be pruned eventually — see retention review (Phase 6) — but this table
# accumulates fast enough (every target, every run) to need its own floor
# now rather than waiting for that broader pass.
RETENTION_DAYS = 14


class CheckOutcome(NamedTuple):
    target_name: str
    url: str
    ok: bool
    latency_ms: Optional[int]
    error: Optional[str]


async def _probe(name: str, base_url: str) -> CheckOutcome:
    url = f"{base_url.rstrip('/')}/api/health"
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url)
        latency_ms = int((time.monotonic() - started) * 1000)
        if res.status_code >= 400:
            return CheckOutcome(name, url, False, latency_ms, f"HTTP {res.status_code}")
        return CheckOutcome(name, url, True, latency_ms, None)
    except Exception as exc:
        latency_ms = int((time.monotonic() - started) * 1000)
        return CheckOutcome(name, url, False, latency_ms, str(exc)[:500])


async def run_checks() -> List[CheckOutcome]:
    """Probes every configured target. Skips any whose URL isn't set rather
    than failing the whole run over one missing config value."""
    configured = [(name, url) for name, url in _TARGETS if url]
    if not configured:
        logger.info("No synthetic check targets configured (STAFF_APP_URL/PUBLIC_APP_URL/OPS_APP_URL all unset).")
        return []
    return [await _probe(name, url) for name, url in configured]


async def run_scheduled_synthetic_checks(ctx) -> str:
    """ARQ cron entrypoint (see app/worker.py's WorkerSettings.cron_jobs)."""
    outcomes = await run_checks()
    if not outcomes:
        return "skipped: no targets configured"

    now = datetime.datetime.now(datetime.timezone.utc)
    async with AsyncSessionLocal() as db:
        for o in outcomes:
            db.add(SyntheticCheckResult(
                target_name=o.target_name, url=o.url, ok=o.ok,
                latency_ms=o.latency_ms, error=o.error, checked_at=now,
            ))
        cutoff = now - datetime.timedelta(days=RETENTION_DAYS)
        await db.execute(delete(SyntheticCheckResult).where(SyntheticCheckResult.checked_at < cutoff))
        await db.commit()

    failed = [o.target_name for o in outcomes if not o.ok]
    if failed:
        logger.warning("Synthetic check failed for: %s", ", ".join(failed))
    return f"checked {len(outcomes)} target(s), {len(failed)} failing"
