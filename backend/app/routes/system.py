import time
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import engine, IS_SQLITE
from app.auth import requires_permission
from app.models import User
from app.config import SECRET_KEY_IS_CONFIGURED, NAIROBIPAY_CALLBACK_SECRET_IS_CONFIGURED, SENTRY_DSN
from app.abac import POLICIES
from app.realtime import get_redis
from app import network_gate, secrets_provider

router = APIRouter(prefix="/api/system", tags=["System (Super Admin)"])

APP_START_TIME = time.time()


def _pool_stats() -> dict:
    if IS_SQLITE:
        return {"type": "NullPool (SQLite dev mode — no real pool)"}
    pool = engine.pool
    try:
        return {
            "type": "QueuePool",
            "size": pool.size(),
            "checkedIn": pool.checkedin(),
            "checkedOut": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    except Exception:
        return {"type": "unavailable"}


@router.get("/health")
async def get_system_health(current_user: User = Depends(requires_permission("view_system_health"))):
    # Database reachability — a real round-trip, not just "the engine object exists."
    db_reachable = True
    db_error = None
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except SQLAlchemyError as e:
        db_reachable = False
        db_error = str(e)[:200]

    # Redis reachability
    redis_reachable = True
    redis_error = None
    try:
        r = await get_redis()
        await r.ping()
    except Exception as e:
        redis_reachable = False
        redis_error = str(e)[:200]

    return {
        "uptimeSeconds": round(time.time() - APP_START_TIME, 1),
        "database": {
            "reachable": db_reachable,
            "error": db_error,
            "engine": "SQLite (dev)" if IS_SQLITE else "PostgreSQL",
            "pool": _pool_stats(),
        },
        "redis": {
            "reachable": redis_reachable,
            "error": redis_error,
        },
        "config": {
            "secretKeyConfigured": SECRET_KEY_IS_CONFIGURED,
            "nairobiPayCallbackSecretConfigured": NAIROBIPAY_CALLBACK_SECRET_IS_CONFIGURED,
            "sentryConfigured": bool(SENTRY_DSN),
        },
        # Whether a managed secrets provider is backing the config, never
        # any secret's value (Readiness List §4).
        "secretsProvider": secrets_provider.status(),
        # Whether the ops console is network-restricted. Surfaced so the
        # gap is visible on the console itself rather than only in a
        # startup log nobody reads (Readiness List §4).
        "opsNetworkGate": network_gate.startup_status(),
        "abacPolicies": [
            {"id": p.id, "description": p.description, "appliesToRoles": list(p.applies_to_roles)}
            for p in POLICIES
        ],
    }
