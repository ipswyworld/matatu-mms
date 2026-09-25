"""
Data-quality/integrity checks (Ops Console Rebuild Spec's Phase 6 item) —
orphaned foreign keys mostly, since dev SQLite never enforces FK
constraints at all (no `PRAGMA foreign_keys=ON` anywhere in app/database.py)
and even Postgres only enforces them for rows written through paths that
actually declare the constraint. No remediation runs from here: this is a
weekly count-and-surface job, same review-only posture as retention.py.
"""
import datetime
import json
import logging
from typing import Dict, List

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import DataQualityCheckResult

logger = logging.getLogger("app.data_quality")

# Each check: a name and a raw SQL query returning the offending rows' ids.
# Raw SQL rather than the ORM here deliberately — a LEFT JOIN ... IS NULL
# anti-join is the natural way to express "rows whose FK target is
# missing", and it needs to run identically against SQLite (dev) and
# Postgres (prod).
CHECKS: Dict[str, str] = {
    "orphaned_fines_matatu": """
        SELECT f.id FROM fines f
        LEFT JOIN matatus m ON m.id = f.matatu_id
        WHERE m.id IS NULL
    """,
    "orphaned_enforcement_cases_officer": """
        SELECT ec.id FROM enforcement_cases ec
        LEFT JOIN users u ON u.id = ec.arresting_officer_id
        WHERE u.id IS NULL
    """,
    "orphaned_bookings_matatu": """
        SELECT b.id FROM bookings b
        LEFT JOIN matatus m ON m.id = b.matatu_id
        WHERE m.id IS NULL
    """,
}

SAMPLE_SIZE = 5


async def run_checks() -> List[Dict]:
    now = datetime.datetime.now(datetime.timezone.utc)
    results = []

    async with AsyncSessionLocal() as db:
        for name, sql in CHECKS.items():
            rows = (await db.execute(text(sql))).fetchall()
            ids = [str(r[0]) for r in rows]
            db.add(DataQualityCheckResult(
                check_name=name, checked_at=now, issue_count=len(ids),
                sample_ids=json.dumps(ids[:SAMPLE_SIZE]) if ids else None,
            ))
            results.append({"checkName": name, "issueCount": len(ids), "sampleIds": ids[:SAMPLE_SIZE]})
        await db.commit()

    flagged = [r for r in results if r["issueCount"] > 0]
    if flagged:
        logger.warning("Data-quality issues found: %s", ", ".join(f"{r['checkName']}={r['issueCount']}" for r in flagged))
    return results


async def run_scheduled_data_quality_checks(ctx) -> str:
    results = await run_checks()
    return f"ran {len(results)} check(s)"
