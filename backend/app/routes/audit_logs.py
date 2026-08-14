from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from app.database import get_db
from app.models import AuditLog, User
from app.schemas import AuditLogResponse
from app.auth import requires_permission

router = APIRouter(prefix="/api/audit-logs", tags=["Audit Trail"])

@router.get("", response_model=List[AuditLogResponse])
async def get_audit_logs(
    current_user: User = Depends(requires_permission("view_audit_logs")),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves all database audit trail logs. No UI page links here anymore
    (removed from admin nav as noise), but the endpoint and the underlying
    audit records stay — this is real compliance data, kept available for
    direct API access/export even without a browsing UI.
    """
    query = select(AuditLog).order_by(AuditLog.timestamp.desc())
    result = await db.execute(query)
    return result.scalars().all()
