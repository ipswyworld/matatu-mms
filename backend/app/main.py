import asyncio
import os
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.database import engine, Base, AsyncSessionLocal, IS_SQLITE
from app.listeners import register_listeners
from app.seed import seed_data
from app.logging_config import configure_logging
from app.config import SENTRY_DSN
from app.rate_limit import limiter

# Error tracking — inert with no config required. Without SENTRY_DSN set,
# this is a no-op (no network calls, no overhead); set it in the environment
# to start receiving unhandled exceptions and their request context.
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        environment=os.getenv("SENTRY_ENVIRONMENT", "development"),
    )

# Import routers
from app.routes.auth import router as auth_router
from app.routes.matatus import router as matatus_router
from app.routes.routes import router as routes_router
from app.routes.activity import router as activity_router
from app.routes.fines import router as fines_router
from app.routes.users import router as users_router
from app.routes.webhooks import router as webhooks_router
from app.routes.payments import router as payments_router
from app.routes.dashboard import router as dashboard_router
from app.routes.saccos import router as saccos_router
from app.routes.audit_logs import router as audit_logs_router
from app.routes.telemetry import router as telemetry_router
from app.routes.crimes import router as crimes_router
from app.routes.bookings import router as bookings_router
from app.routes.reports import router as reports_router
from app.routes.dashboard_events import router as dashboard_events_router, register_dashboard_broadcast_listeners
from app.routes.dashboard_events import broadcaster as dashboard_broadcaster
from app.routes.enforcement_cases import router as enforcement_cases_router
from app.routes.notifications import router as notifications_router
from app.routes.notifications import broadcaster as notifications_broadcaster
from app.routes.telemetry import broadcaster as telemetry_broadcaster
from app.routes.system import router as system_router
from app.routes.crew import router as crew_router
from app.routes.fare_stages import router as fare_stages_router
from app.routes.beats import router as beats_router
from app.routes.analytics import router as analytics_router
from app.routes.search import router as search_router
from app.routes.demand import router as demand_router
from app.routes.deviations import router as deviations_router
from app.routes.public_updates import router as public_updates_router
from app.routes.trips import router as trips_router
from app.routes.uploads import router as uploads_router
from app.routes.feature_flags import router as feature_flags_router
from app.routes.jobs import router as jobs_router
from app.routes.control import router as control_router
from app.routes.oauth import router as oauth_router
from app.routes.partner import router as partner_router
from app.routes.ledger_routes import router as ledger_router
from app.routes.messaging_routes import router as messaging_router
from app.routes.compliance import router as compliance_router
from app.realtime import close_redis

# Structured JSON logging — queryable by a log aggregator (Loki/ELK) once
# this runs on real infrastructure, instead of grepping plain-text stdout.
configure_logging(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("app.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing system...")
    
    # 1. Register event dispatcher listeners
    register_listeners()
    register_dashboard_broadcast_listeners()
    logger.info("Event listeners registered.")

    # 1b. Start the Redis-backed real-time broadcasters — GPS telemetry,
    # dashboard live-refresh, and per-user notifications all fan out through
    # Redis pub/sub so they work correctly across multiple backend instances,
    # not just the process that received the triggering request.
    telemetry_broadcaster.start()
    dashboard_broadcaster.start()
    notifications_broadcaster.start()
    logger.info("Real-time broadcasters started.")

    # 1c. Durable event consumer (app/streams.py, §4.2) — Postgres/prod mode
    # only, matching the IS_SQLITE convention used throughout (fast/no-
    # services SQLite path is unaffected). Task reference kept for a clean
    # cancel on shutdown, same pattern as the broadcasters above.
    event_consumer_task = None
    arq_worker_task = None
    if not IS_SQLITE:
        from app.streams import consume_events_forever
        event_consumer_task = asyncio.create_task(consume_events_forever("consumer-1"))
        logger.info("Durable event consumer started.")

        # 1d. ARQ task queue (§4.2) — embedded in-process, see app/worker.py
        # docstring for why. Available for new background job types
        # (fare-chart parsing, report generation, ...) to enqueue into via
        # app.worker.get_arq_pool(); existing direct-call flows are
        # unchanged.
        from app.worker import run_worker
        arq_worker_task = asyncio.create_task(run_worker())
        logger.info("ARQ task worker started.")

    # 2. Create database schema tables. Postgres schema is now owned by
    # Alembic migrations (run `alembic upgrade head` before starting the
    # app) — create_all only runs here for the SQLite dev fallback, where
    # there's no migration history to preserve and zero-setup convenience
    # matters more than migration discipline.
    if IS_SQLITE:
        logger.info("Synchronizing database tables (SQLite dev mode — no Alembic)...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    else:
        logger.info("Postgres detected — schema is managed by Alembic migrations, skipping auto-create.")

    # 3. Seed default mock data
    logger.info("Verifying default seed data...")
    async with AsyncSessionLocal() as session:
        await seed_data(session)

    # 3b. Live rate limits (app/ops_limits.py) — seed the in-process cache
    # from Postgres BEFORE serving any request, so a restarted process
    # doesn't silently revert every override to its coded default, then
    # start the refresh loop that keeps replicas converged.
    from app import ops_breakers, ops_controls, ops_limits, ops_metrics
    async with AsyncSessionLocal() as session:
        await ops_limits.load_from_db(session)
        await ops_controls.load_from_db(session)
    await ops_limits.publish_to_redis()
    await ops_controls.publish_to_redis()
    ops_limits.start_refresh_task()
    ops_controls.start_refresh_task()
    # Breaker overrides and request metrics are shared through Redis so the
    # ops console sees this process even when it runs as a separate control
    # plane (Ops Console Rebuild Spec §3.1 Path A).
    await ops_breakers.load_overrides()
    ops_breakers.start_refresh_task()
    ops_metrics.start_publish_task()
    logger.info("Ops control state loaded (rate limits, system controls, breakers, metrics).")

    logger.info("System initialization complete.")
    
    yield
    
    # Cleanup on shutdown (close async engines)
    logger.info("Cleaning up resources...")
    telemetry_broadcaster.stop()
    dashboard_broadcaster.stop()
    notifications_broadcaster.stop()
    from app import ops_breakers, ops_controls, ops_limits, ops_metrics
    ops_limits.stop_refresh_task()
    ops_controls.stop_refresh_task()
    ops_breakers.stop_refresh_task()
    ops_metrics.stop_publish_task()
    if event_consumer_task is not None:
        event_consumer_task.cancel()
    if arq_worker_task is not None:
        arq_worker_task.cancel()
    await close_redis()
    await engine.dispose()
    logger.info("Shutdown complete.")

app = FastAPI(
    title="NCCG Matatu Management System API",
    description="Asynchronous Python FastAPI backend prototype for Nairobi City County Government Matatu compliance tracking.",
    version="1.0.0",
    lifespan=lifespan
)

# OpenTelemetry distributed tracing (§8) — see app/tracing.py for why this
# is added now rather than after the service split, and how it degrades
# safely with no tracing backend deployed.
from app.tracing import setup_tracing
setup_tracing(app)

# Rate limiting — per-client-IP, Redis-backed so limits hold across replicas
# (see app/rate_limit.py). Individual limits are applied per-route via
# @limiter.limit(...) on the endpoints that need it (auth, booking,
# NairobiPay callback) rather than one blanket limit for the whole API.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Security response headers (§15.4) — API-side counterpart to
# matatu-mms/next.config.mjs's headers() for the frontend; direct API
# clients (or anything inspecting backend responses specifically) get the
# same protection. No CSP here deliberately: CSP governs how a *page*
# renders/executes content, meaningless on a JSON API response.
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


# Maintenance mode (app/ops_controls.py) — the Critical-tier lever that
# takes the system out of service. Registered before the metrics middleware
# so a rejected request is still counted; ordering matters because Starlette
# runs the most recently added middleware first.
#
# /api/control is always exempt, so an operator can always turn maintenance
# back off. The lever can never lock out the hand that pulls it.
@app.middleware("http")
async def enforce_maintenance_mode(request: Request, call_next):
    from app import ops_controls

    if ops_controls.blocks_request(request.url.path):
        return JSONResponse(
            status_code=503,
            content={
                "detail": ops_controls.maintenance_message(),
                "maintenance": True,
                "scope": ops_controls.maintenance_scope(),
            },
            headers={"Retry-After": "120"},
        )
    return await call_next(request)


# Rolling request metrics for the ops console's live feed (app/ops_metrics.py).
# In-process and bounded-memory by design — this is not a Prometheus
# replacement, it exists so the console still shows request and error rates
# during an incident in which the external metrics backend may itself be
# unreachable.
@app.middleware("http")
async def record_request_metrics(request: Request, call_next):
    from app.ops_metrics import metrics

    started = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        # The SSE stream is a single long-lived request; recording it would
        # skew p95 latency into meaninglessness.
        if not request.url.path.startswith("/api/control/stream"):
            try:
                metrics.record(
                    duration_ms=(time.perf_counter() - started) * 1000,
                    status_code=status_code,
                    method=request.method,
                    path=request.url.path,
                )
            except Exception:
                # Metrics must never break a request.
                pass

# Configure CORS for Next.js frontend communication. Extra origins (e.g. a
# deployed frontend URL) come from CORS_ORIGINS as a comma-separated list —
# the localhost defaults always stay allowed for local dev. Port 3000 is the
# staff app's default dev port, 3001 the public app's (see the split into
# two separate frontends: matatu-mms/ and matatu-mms-public/).
_extra_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3001", "http://127.0.0.1:3001",
        *_extra_cors_origins,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus metrics — request latency/count/status histograms per route,
# exposed at GET /metrics for Prometheus to scrape. Excluded from the metrics
# it collects (scraping /metrics about /metrics is noise).
Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

# Register routers
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(matatus_router)
app.include_router(routes_router)
app.include_router(activity_router)
app.include_router(fines_router)
app.include_router(users_router)
app.include_router(webhooks_router)
app.include_router(payments_router)
app.include_router(saccos_router)
app.include_router(audit_logs_router)
app.include_router(telemetry_router)
app.include_router(crimes_router)
app.include_router(bookings_router)
app.include_router(reports_router)
app.include_router(dashboard_events_router)
app.include_router(enforcement_cases_router)
app.include_router(notifications_router)
app.include_router(system_router)
app.include_router(crew_router)
app.include_router(fare_stages_router)
app.include_router(beats_router)
app.include_router(analytics_router)
app.include_router(search_router)
app.include_router(demand_router)
app.include_router(deviations_router)
app.include_router(public_updates_router)
app.include_router(trips_router)
app.include_router(uploads_router)
app.include_router(feature_flags_router)
app.include_router(jobs_router)
# Ops control plane (Ops Console Rebuild Spec §6). Mounted here for now;
# the /api/control prefix is what lets it be lifted into its own uvicorn
# entrypoint later (Spec §3.1 Path A) without any client change.
app.include_router(control_router)
# Partner API (Readiness List §14) — OAuth2 client-credentials plus the
# versioned /api/v1 surface. Versioned from the first release because
# Sacco integrators will not upgrade on our schedule.
app.include_router(oauth_router)
app.include_router(partner_router)
# Revenue ledger reporting (Readiness List §15). Read-only: postings
# happen as a side effect of business events, never as a standalone
# 'adjust the books' action.
app.include_router(ledger_router)
# Messaging consent, delivery receipts and spend (Readiness List §19).
app.include_router(messaging_router)
# Data-subject rights and integrity monitoring (Readiness List §9, §17).
app.include_router(compliance_router)

# Serves uploaded verification/onboarding documents when app/storage.py is
# in local-disk mode (dev, or the self-hosted docker-compose stack's
# persistent volume). The "db" and "s3" backends don't use this at all —
# "db"-stored files are served by uploads_router above instead, and "s3"
# files are fetched directly from the bucket's own public URL.
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

@app.get("/")
async def root():
    return {
        "status": "online",
        "system": "NCCG Matatu Management System (Python Prototype)",
        "docs_url": "/docs"
    }

@app.get("/healthz", include_in_schema=False)
@app.get("/health", include_in_schema=False)
@app.get("/api/health", include_in_schema=False)
async def healthz():
    """
    Liveness probe: is the process itself up? Deliberately does NOT touch
    the database — a slow/unreachable DB should fail readiness, not
    liveness, or an orchestrator would kill and restart a healthy process
    that's just waiting on a struggling database.
    """
    return {"status": "ok"}

@app.get("/readyz", include_in_schema=False)
@app.get("/livez", include_in_schema=False)
async def readyz():
    """Readiness probe: can this instance actually serve traffic right now?"""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as e:
        logger.error("Readiness check failed: database unreachable", extra={"error": str(e)})
        return JSONResponse(status_code=503, content={"status": "not_ready", "reason": "database_unreachable"})
    return {"status": "ready"}
