import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text

from app.database import engine, Base, AsyncSessionLocal
from app.listeners import register_listeners
from app.seed import seed_data
from app.logging_config import configure_logging

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

    # 2. Create database schema tables
    logger.info("Synchronizing database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    # 3. Seed default mock data
    logger.info("Verifying default seed data...")
    async with AsyncSessionLocal() as session:
        await seed_data(session)
    logger.info("System initialization complete.")
    
    yield
    
    # Cleanup on shutdown (close async engines)
    logger.info("Cleaning up resources...")
    telemetry_broadcaster.stop()
    dashboard_broadcaster.stop()
    notifications_broadcaster.stop()
    await close_redis()
    await engine.dispose()
    logger.info("Shutdown complete.")

app = FastAPI(
    title="NCCG Matatu Management System API",
    description="Asynchronous Python FastAPI backend prototype for Nairobi City County Government Matatu compliance tracking.",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS for Next.js frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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

# Serve uploaded verification/onboarding documents (dev-only local disk
# storage — will move to object storage e.g. S3/GCS behind Postgres+Redis
# when this goes to a real server).
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
