"""
Lightweight support-ticket triage (Ops Console Rebuild Spec's Phase 8 item)
— a status/assignee/priority list for the staff app, not a full helpdesk
system. Gated by manage_users (already ADMIN/SUPERADMIN-only) rather than a
new rbac.py permission, since this feature is small enough not to warrant
one.
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import stage_audit_log
from app.auth import requires_permission
from app.database import get_db
from app.models import SupportTicket, User

router = APIRouter(prefix="/api/support-tickets", tags=["Support Tickets"])

STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]
PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"]


class TicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    priority: str = "MEDIUM"
    reporter_name: str = Field(min_length=1, max_length=200)
    reporter_contact: str = Field(min_length=1, max_length=200)


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[str] = None


def _serialize(t: SupportTicket) -> dict:
    return {
        "id": t.id, "subject": t.subject, "description": t.description,
        "status": t.status, "priority": t.priority, "assigneeId": t.assignee_id,
        "reporterName": t.reporter_name, "reporterContact": t.reporter_contact,
        "createdBy": t.created_by, "createdAt": t.created_at.isoformat(),
        "updatedAt": t.updated_at.isoformat(),
        "resolvedAt": t.resolved_at.isoformat() if t.resolved_at else None,
    }


@router.get("")
async def list_tickets(
    current_user: User = Depends(requires_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(SupportTicket).order_by(SupportTicket.created_at.desc()))).scalars().all()
    return [_serialize(t) for t in rows]


@router.post("")
async def create_ticket(
    body: TicketCreate,
    current_user: User = Depends(requires_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
):
    if body.priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"priority must be one of: {', '.join(PRIORITIES)}")

    now = datetime.datetime.now(datetime.timezone.utc)
    ticket = SupportTicket(
        subject=body.subject, description=body.description, status="OPEN", priority=body.priority,
        reporter_name=body.reporter_name, reporter_contact=body.reporter_contact,
        created_by=current_user.id, created_at=now, updated_at=now,
    )
    db.add(ticket)
    await db.flush()
    stage_audit_log(
        db, resource_type="support_ticket", resource_id=str(ticket.id), action="CREATE",
        user_id=current_user.id, new_values={"subject": body.subject, "priority": body.priority},
    )
    await db.commit()
    return _serialize(ticket)


@router.patch("/{ticket_id}")
async def update_ticket(
    ticket_id: int,
    body: TicketUpdate,
    current_user: User = Depends(requires_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
):
    ticket = (await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))).scalars().first()
    if ticket is None:
        raise HTTPException(status_code=404, detail="No ticket with that id")

    old_values = {"status": ticket.status, "priority": ticket.priority, "assigneeId": ticket.assignee_id}

    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(STATUSES)}")
        ticket.status = body.status
        if body.status in ("RESOLVED", "CLOSED") and ticket.resolved_at is None:
            ticket.resolved_at = datetime.datetime.now(datetime.timezone.utc)
        elif body.status in ("OPEN", "IN_PROGRESS"):
            ticket.resolved_at = None

    if body.priority is not None:
        if body.priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail=f"priority must be one of: {', '.join(PRIORITIES)}")
        ticket.priority = body.priority

    if body.assignee_id is not None:
        ticket.assignee_id = body.assignee_id or None

    ticket.updated_at = datetime.datetime.now(datetime.timezone.utc)

    stage_audit_log(
        db, resource_type="support_ticket", resource_id=str(ticket_id), action="UPDATE",
        user_id=current_user.id, old_values=old_values,
        new_values={"status": ticket.status, "priority": ticket.priority, "assigneeId": ticket.assignee_id},
    )
    await db.commit()
    return _serialize(ticket)
