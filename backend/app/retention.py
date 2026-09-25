"""
Data-retention review (Ops Console Rebuild Spec's Phase 6 item) — review
only, never a purge. Kenya's Data Protection Act sets a 7-year statutory
floor on records like these; this surfaces what's now old enough to be a
genuine deletion candidate, for a human with legal/records-retention
sign-off to act on in a future, separately-gated phase. Nothing in this
module deletes a row.

Scoped to two concrete, genuinely closed record types rather than every
table in the system — a broad "review everything" pass would need a
retention policy per table, most of which nobody has actually decided yet.
"""
import datetime
import logging
from typing import Callable, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import EnforcementCase, Fine, RetentionReviewSnapshot

logger = logging.getLogger("app.retention")

RETENTION_YEARS = 7

# EnforcementCase's terminal statuses (models.py's own comment lists the
# full state machine) — DISPUTED/UNDER_REVIEW/ARRESTED are still open.
CLOSED_CASE_STATUSES = ["RELEASED", "RESOLVED_UPHELD", "RESOLVED_OVERTURNED", "RESOLVED_PARTIAL", "WAIVED"]


class RetentionTable:
    def __init__(self, name: str, model, date_column, closed_filter: Optional[Callable] = None):
        self.name = name
        self.model = model
        self.date_column = date_column
        self.closed_filter = closed_filter


RETENTION_TABLES: List[RetentionTable] = [
    RetentionTable("fines", Fine, Fine.issued_at, lambda: Fine.status == "PAID"),
    RetentionTable(
        "enforcement_cases", EnforcementCase, EnforcementCase.created_at,
        lambda: EnforcementCase.status.in_(CLOSED_CASE_STATUSES),
    ),
]


async def _scan_table(db: AsyncSession, table: RetentionTable, cutoff: datetime.datetime) -> Dict:
    conditions = [table.date_column < cutoff]
    if table.closed_filter is not None:
        conditions.append(table.closed_filter())

    count = (await db.execute(select(func.count()).select_from(table.model).where(*conditions))).scalar_one()
    oldest = None
    if count:
        oldest = (
            await db.execute(select(func.min(table.date_column)).where(*conditions))
        ).scalar_one()
    return {"tableName": table.name, "eligibleCount": count, "oldestEligibleDate": oldest}


async def scan_now() -> List[Dict]:
    """Runs the review and persists one snapshot row per table. Used by
    both the weekly cron and the manual scan-now endpoint — identical
    behavior either way, since this only ever reads and records counts."""
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=RETENTION_YEARS * 365)
    now = datetime.datetime.now(datetime.timezone.utc)
    results = []

    async with AsyncSessionLocal() as db:
        for table in RETENTION_TABLES:
            result = await _scan_table(db, table, cutoff)
            db.add(RetentionReviewSnapshot(
                scanned_at=now, table_name=result["tableName"],
                eligible_count=result["eligibleCount"], oldest_eligible_date=result["oldestEligibleDate"],
            ))
            results.append(result)
        await db.commit()

    if any(r["eligibleCount"] for r in results):
        logger.info("Retention review: %s", ", ".join(f"{r['tableName']}={r['eligibleCount']}" for r in results))
    return results


async def run_scheduled_retention_scan(ctx) -> str:
    results = await scan_now()
    return f"scanned {len(results)} table(s)"
