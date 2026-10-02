"""
Data-subject rights and integrity monitoring endpoints
(Readiness List §9, §17).

Access control here is deliberately strict in different ways for the two
concerns:

  * A subject may always export their OWN data without special permission —
    that is the statutory right, and putting it behind an admin queue would
    make the county the bottleneck on a legal deadline.
  * Exporting someone ELSE's data, and erasure, require admin-tier
    permission and are audited, because they are the two operations most
    useful to an attacker who has taken over a staff account.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app import data_rights, integrity
from app.audit import stage_audit_log
from app.auth import get_current_user, requires_permission
from app.database import get_db
from app.models import User

logger = logging.getLogger("app.routes.compliance")
router = APIRouter(prefix="/api/compliance", tags=["Compliance & Integrity"])


class ErasureRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=500)
    confirm_subject_id: str


@router.get("/my-data")
async def export_my_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A subject's own data, on request.

    No special permission: this is the right itself. Requiring an admin to
    approve it would put the county in the way of a statutory deadline.
    """
    data = await data_rights.export_subject_data(db, current_user.id)
    stage_audit_log(
        db, resource_type="user", resource_id=current_user.id,
        action="DATA_EXPORT_SELF", user_id=current_user.id,
    )
    await db.commit()
    return data


@router.get("/subject/{user_id}/export")
async def export_subject(
    user_id: str,
    current_user: User = Depends(requires_permission("manage_admins")),
    db: AsyncSession = Depends(get_db),
):
    """Export on behalf of a subject who asked by another channel.

    Audited, because bulk access to citizens' records is precisely what a
    compromised staff account would be used for.
    """
    data = await data_rights.export_subject_data(db, user_id)
    if not data:
        raise HTTPException(status_code=404, detail="No such subject")

    stage_audit_log(
        db, resource_type="user", resource_id=user_id,
        action="DATA_EXPORT_ON_BEHALF", user_id=current_user.id,
    )
    await db.commit()
    return data


@router.post("/subject/{user_id}/erase")
async def erase_subject(
    user_id: str,
    body: ErasureRequest,
    current_user: User = Depends(requires_permission("manage_admins")),
    db: AsyncSession = Depends(get_db),
):
    """Anonymise a subject, retaining records held under legal obligation.

    Requires the subject id to be repeated in the body. Erasure is
    irreversible by construction — the pseudonym is a one-way hash — so a
    mistyped path parameter would destroy the wrong person's identifiers
    with no way back.
    """
    if body.confirm_subject_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="confirm_subject_id must match the subject in the path.",
        )
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot erase your own account while using it to authenticate.",
        )

    try:
        return await data_rights.erase_subject_data(
            db, user_id, actor_id=current_user.id, reason=body.reason
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/integrity")
async def integrity_report(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(requires_permission("view_system_health")),
    db: AsyncSession = Depends(get_db),
):
    """Fraud and revenue-integrity signals for human review."""
    report = await integrity.run_all(db, days=days)
    if report["criticalFindings"]:
        logger.error(
            "Integrity report contains %d critical finding(s)", report["criticalFindings"]
        )
    return report
