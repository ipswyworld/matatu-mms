"""
Public, unauthenticated status page (Ops Console Rebuild Spec's Phase 8
item) — deliberately a reduced view: up/down per dependency only, no
deploy SHAs, commit info, or anything else an internal dashboard shows.
Anyone can hit this with no session, so it has to stay that narrow.
"""
from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import engine
from app.realtime import get_redis
from app import ops_controls

router = APIRouter(prefix="/api/status", tags=["Public Status"])


@router.get("/public")
async def get_public_status():
    db_up = True
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except SQLAlchemyError:
        db_up = False

    redis_up = True
    try:
        r = await get_redis()
        await r.ping()
    except Exception:
        redis_up = False

    return {
        "services": [
            {"name": "API", "up": True},  # responding to this request at all
            {"name": "Database", "up": db_up},
            {"name": "Cache", "up": redis_up},
        ],
        "maintenanceActive": ops_controls.is_maintenance_active(),
        "maintenanceAnnouncement": ops_controls.get_announcement(),
    }
