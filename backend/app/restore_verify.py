"""
Weekly backup-restore verification (Ops Console Rebuild Spec's Phase 6 item)
— proves the nightly backup (app/backup.py) can actually be restored, not
just that the upload succeeded. Nightly backups had run since this session
started but had never been restored anywhere; this closes that gap the same
way db-backups/restore_db.py already does it by hand (retry-until-no-
progress insertion order for FK dependencies, ON CONFLICT DO NOTHING), just
scheduled and automatic.

Restores into RESTORE_VERIFY_DATABASE_URL — a dedicated scratch database,
never production, never the read replica. The operator provisions it and
runs `alembic upgrade head` against it once, out of band; this module only
ever TRUNCATEs and re-inserts into it, never migrates it. Unset means the
test is skipped with a clear log line, matching every other optional-
integration convention in this codebase.
"""
import datetime
import logging
import time
from typing import Any, Dict

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.backup import download_latest_backup
from app.config import RESTORE_VERIFY_DATABASE_URL
from app.database import AsyncSessionLocal
from app.models import BackupRestoreTest

logger = logging.getLogger("app.restore_verify")

# Same two tables db-backups/restore_db.py already excludes: alembic_version
# is schema bookkeeping the scratch DB's own migration run already set
# correctly, and spatial_ref_sys is a PostGIS reference table that ships
# populated with the extension, not application data.
SKIP_TABLES = {"alembic_version", "spatial_ref_sys"}


async def _restore_into_scratch(tables: Dict[str, list]) -> Dict[str, int]:
    engine = create_async_engine(RESTORE_VERIFY_DATABASE_URL, pool_pre_ping=True)
    row_counts: Dict[str, int] = {}
    try:
        async with engine.begin() as conn:
            existing = {
                row[0]
                for row in (
                    await conn.execute(
                        text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                    )
                ).fetchall()
            }
            # TRUNCATE every restorable table up front — a full restore test
            # should prove the backup stands alone, not that it merges
            # cleanly with whatever the scratch DB already had in it.
            restorable = [t for t in tables if t in existing and t not in SKIP_TABLES]
            if restorable:
                cols = ", ".join(f'"{t}"' for t in restorable)
                await conn.execute(text(f"TRUNCATE TABLE {cols} RESTART IDENTITY CASCADE"))

            pending = {t: rows for t, rows in tables.items() if t in restorable and rows}
            passes = len(pending) + 2
            for _ in range(passes):
                if not pending:
                    break
                progressed = False
                for name, rows in list(pending.items()):
                    cols = list(rows[0].keys())
                    col_list = ", ".join(f'"{c}"' for c in cols)
                    placeholders = ", ".join(f":{c}" for c in cols)
                    stmt = text(f'INSERT INTO "{name}" ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING')
                    try:
                        for row in rows:
                            await conn.execute(stmt, row)
                        row_counts[name] = len(rows)
                        del pending[name]
                        progressed = True
                    except Exception as exc:
                        last_error = str(exc).splitlines()[0][:200]
                if not progressed:
                    raise RuntimeError(
                        f"Could not satisfy FK order for: {sorted(pending.keys())} — last error: {last_error}"
                    )
    finally:
        await engine.dispose()
    return row_counts


async def run_restore_test(ctx=None) -> Dict[str, Any]:
    """ARQ cron entrypoint (app/worker.py) and the manual-trigger endpoint's
    implementation (backend/app/routes/control.py's test-restore route)."""
    if not RESTORE_VERIFY_DATABASE_URL:
        logger.info("Backup restore test skipped: RESTORE_VERIFY_DATABASE_URL not configured.")
        return {"skipped": True, "reason": "RESTORE_VERIFY_DATABASE_URL not configured"}

    started = time.monotonic()
    now = datetime.datetime.now(datetime.timezone.utc)
    success = False
    row_counts: Dict[str, int] = {}
    backup_tag = None
    error = None

    try:
        manifest = await download_latest_backup()
        if manifest is None:
            raise RuntimeError("No backup release found to restore from.")
        backup_tag = manifest.get("_tag")
        row_counts = await _restore_into_scratch(manifest["tables"])
        success = True
    except Exception as exc:
        logger.exception("Backup restore test failed")
        error = str(exc)[:2000]

    duration = round(time.monotonic() - started, 2)
    import json as _json

    async with AsyncSessionLocal() as db:
        db.add(BackupRestoreTest(
            tested_at=now, success=success, duration_seconds=duration,
            backup_tag=backup_tag, row_counts=_json.dumps(row_counts) if row_counts else None,
            error=error,
        ))
        await db.commit()

    return {
        "success": success, "durationSeconds": duration, "backupTag": backup_tag,
        "rowCounts": row_counts, "error": error,
    }
