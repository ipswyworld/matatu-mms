"""
ARQ task queue (ARCHITECTURE_DECISIONS.md §4.2) — the real background-job
mechanism new job types should route through: fare-chart PDF parsing,
TomTom routing calls for route geometry, report generation, notification
delivery, each with ARQ's built-in retries and a dead-letter path (failed
jobs land in ARQ's own result store instead of vanishing, unlike a bare
`asyncio.create_task`).

Run in-process (via run_worker() below, started as a background asyncio
task at app startup — see app/main.py) rather than a separate worker
process/dyno: Render's current deploy is a single web service with no
second process type provisioned, and every other background mechanism in
this codebase (telemetry/dashboard/notification broadcasters, the event
consumer in app/streams.py) already follows that same in-process pattern.
Splitting this into a real standalone worker service is a natural follow-
up once there's a second Render service to run it on — nothing about the
job functions below would need to change, only how run_worker() is
invoked.

One real job is wired here: webhook delivery, reusing the exact retry/
circuit-breaker logic already in app/listeners.py (not duplicated). This
is deliberately additive infrastructure, not a replacement for the
existing direct-call webhook path in listeners.py — see events.py's
dispatch() docstring for why: migrating that one already-tested, already-
verified-live call site onto the queue is real follow-up work, done
separately from proving the queue itself works.

A second job is scheduled rather than triggered: run_scheduled_backup
(app/backup.py), via arq's own `cron_jobs` — the first genuinely recurring
job in this codebase (everything else here and in app/streams.py fires on
an event, never on a clock). WorkerSettings.cron_jobs is not automatically
read by anything; run_worker() below has to pass it into the Worker(...)
constructor explicitly, same as functions/redis_settings/max_tries already
are.
"""
import asyncio
import logging

from arq import create_pool
from arq.connections import RedisSettings
from arq.cron import cron
from arq.worker import Worker

from app.backup import run_scheduled_backup
from app.config import REDIS_URL
from app.synthetic_checks import run_scheduled_synthetic_checks
from app.feature_flag_scheduler import run_scheduled_flag_flips
from app.scheduled_booking_scheduler import run_scheduled_booking_sweep
from app.restore_verify import run_restore_test
from app.retention import run_scheduled_retention_scan
from app.data_quality import run_scheduled_data_quality_checks

logger = logging.getLogger("app.worker")

_pool = None


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(REDIS_URL)


async def get_arq_pool():
    """Shared job-enqueue pool for this process, lazily created."""
    global _pool
    if _pool is None:
        _pool = await create_pool(_redis_settings())
    return _pool


async def deliver_webhook_job(ctx, subscription_id: int, url: str, event_type: str, payload: dict, secret: str | None = None) -> str:
    """ARQ job wrapping the existing resilient webhook delivery — real
    retries (ARQ re-runs a failed job up to WorkerSettings.max_tries) and a
    dead-letter path (a job that exhausts retries is recorded in ARQ's
    result store, inspectable via arq's result API, rather than the
    outcome simply never being logged)."""
    from app.listeners import deliver_webhook_with_resilience, subscription_breakers
    from app.resilience import CircuitBreaker

    if subscription_id not in subscription_breakers:
        subscription_breakers[subscription_id] = CircuitBreaker(failure_threshold=3, recovery_time=30.0)
    breaker = subscription_breakers[subscription_id]

    await deliver_webhook_with_resilience(subscription_id, url, event_type, payload, breaker, secret)
    return "delivered"


class WorkerSettings:
    functions = [deliver_webhook_job]
    # 03:00 UTC — outside both Nairobi's (UTC+3, 06:00 local) and any
    # plausible US/EU operator's business hours, and well clear of the
    # commute-peak traffic this system's own metrics show (§4 dashboard).
    # A dump reads every row in every table; running it against live
    # traffic would only ever make it slower or more contended, never
    # meaningfully safer, so there's no reason to run it at peak instead.
    cron_jobs = [
        cron(run_scheduled_backup, hour=3, minute=0),
        # Every 5 minutes — frequent enough that a real outage shows up on
        # the Overview page within one or two operator glances, not so
        # frequent it meaningfully adds to each frontend's own request load.
        cron(run_scheduled_synthetic_checks, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
        # Every minute — a scheduled flag flip is a discrete, time-sensitive
        # event (someone picked an exact moment for a reason), unlike the
        # synthetic checks above where a few minutes of slack is fine.
        cron(run_scheduled_flag_flips, minute=set(range(60))),
        # Sunday 03:30 UTC — 30 minutes after the nightly backup's 03:00
        # slot, so this always restores that night's freshly-uploaded
        # backup rather than racing it.
        cron(run_restore_test, weekday="sun", hour=3, minute=30),
        cron(run_scheduled_retention_scan, weekday="mon", hour=4, minute=0),
        cron(run_scheduled_data_quality_checks, weekday="mon", hour=4, minute=15),
        # Every 5 minutes — a scheduled trip's reminder/auto-confirm window
        # is measured in tens of minutes, so this cadence is frequent enough
        # not to miss it while not adding meaningfully to load.
        cron(run_scheduled_booking_sweep, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
    ]
    redis_settings = _redis_settings()
    max_tries = 3
    # Required for the ops console's "cancel job" action (Ops Console
    # Rebuild Spec §6.2). Without this, arq's Job.abort() can only remove a
    # job that hasn't started yet; with it, a job already executing is
    # cancelled too, which is what an operator means by "make this stop".
    allow_abort_jobs = True


async def run_worker() -> None:
    """Runs the ARQ worker loop in-process. Started as a background
    asyncio task at app startup (Postgres/prod mode only, matching the
    IS_SQLITE convention — see app/main.py); awaited forever until
    cancelled on shutdown."""
    worker = Worker(
        functions=WorkerSettings.functions,
        cron_jobs=WorkerSettings.cron_jobs,
        redis_settings=WorkerSettings.redis_settings,
        max_tries=WorkerSettings.max_tries,
        allow_abort_jobs=WorkerSettings.allow_abort_jobs,
        # This worker runs embedded in the same asyncio loop as
        # uvicorn/FastAPI (see module docstring) — arq's default
        # signal-handler installation would fight with uvicorn's own
        # SIGTERM/SIGINT handling for graceful shutdown. Lifecycle is
        # controlled by cancelling the task instead (app/main.py).
        handle_signals=False,
    )
    try:
        await worker.async_run()
    except asyncio.CancelledError:
        raise
    finally:
        try:
            await worker.close()
        except Exception:
            # worker.close() sends itself SIGUSR1 to unblock a pending
            # health-check sleep, which doesn't exist on Windows — harmless
            # locally (this task is already being cancelled either way),
            # and Render's containers are Linux, where this path is normal.
            logger.debug("Worker close() raised during shutdown", exc_info=True)
