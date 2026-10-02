from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import AuditLog, User
from app.schemas import AuditLogResponse
from app.auth import requires_permission

router = APIRouter(prefix="/api/audit-logs", tags=["Audit Trail"])

@router.get("", response_model=List[AuditLogResponse])
async def get_audit_logs(
    limit: int = Query(100, ge=1, le=500),
    before_id: Optional[int] = Query(None, description="Keyset cursor — return records with id < before_id, for paging further back."),
    action: Optional[str] = Query(None, description="Comma-separated action names to filter to, e.g. IMPERSONATION_START,IMPERSONATION_END."),
    current_user: User = Depends(requires_permission("view_audit_logs")),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves database audit trail logs, most recent first. No UI page links
    here anymore (removed from admin nav as noise), but the endpoint and the
    underlying audit records stay — this is real compliance data, kept
    available for direct API access/export even without a browsing UI.

    Keyset (not offset) pagination: AuditLog.id is a real auto-incrementing
    integer that correlates with insertion order, so cursoring on it stays
    O(1) regardless of table size — unlike OFFSET, which gets slower the
    deeper you page. Pass `before_id` (the last id from the previous page)
    to continue further back; omit it for the most recent page.

    `action` exists specifically for the ops console's dedicated
    impersonation-session-log view (a filtered read over already-captured
    IMPERSONATION_START/END events, not new capture) — nothing else in this
    codebase needed action-filtering until that view did.
    """
    query = select(AuditLog).order_by(AuditLog.id.desc())
    if before_id is not None:
        query = query.where(AuditLog.id < before_id)
    if action:
        query = query.where(AuditLog.action.in_([a.strip() for a in action.split(",") if a.strip()]))
    query = query.limit(limit)
    result = await db.execute(query)
    return result.scalars().all()
