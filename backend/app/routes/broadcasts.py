"""
Command broadcasts — a commander sending orders to one officer, a zone, a
sector, or everyone.

Persisted, unlike every other notification in this system. notify_user()
is explicitly documented as "a live nudge, not a durable inbox": if the
recipient's browser is closed, the toast is simply missed. That is the
right trade for "your booking is confirmed" and the wrong one for "report
to Muthurwa at 0600" — an order nobody can prove was issued, delivered or
read is not an order. So a broadcast is a row first and a live push
second, and the live push is best-effort on top.

Recipients are resolved at send time into broadcast_recipients rather than
re-derived on read. An officer posted into Sector 4 tomorrow was not sent
yesterday's order and must not retroactively appear to have been; an
officer posted out of it still needs to see what they were actually sent.
Re-running the audience query on read gets both of those wrong.
"""
import datetime
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.audit import stage_audit_log
from app.auth import get_current_user, requires_permission
from app.database import get_db
from app.models import Broadcast, BroadcastRecipient, DutyAllocation, DutyAssignment, Sector, User, Zone
from app.rbac import ENFORCEMENT_ROLES
from app.routes.notifications import notify_user
from app.schemas import BroadcastCreate, BroadcastResponse

router = APIRouter(prefix="/api/broadcasts", tags=["Command Broadcasts"])

AUDIENCES = {"ALL", "SECTOR", "ZONE", "OFFICER"}
PRIORITIES = {"NORMAL", "URGENT"}


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _officers_in_scope(
    db: AsyncSession, *, sector_id: Optional[str] = None, zone_id: Optional[str] = None
) -> List[User]:
    """Who is currently in a sector or zone.

    Primary source is the live published allocation for the current month —
    that is the authoritative "who is posted where" and matches what the
    commander is looking at when they hit send. Falls back to the older
    sticky User.assigned_zone_id when no allocation has been published yet,
    so a broadcast still reaches someone in a month where the sheet has not
    been issued, rather than silently reaching nobody.
    """
    today = _now().date()
    alloc = (
        await db.execute(
            select(DutyAllocation).where(
                DutyAllocation.year == today.year,
                DutyAllocation.month == today.month,
                DutyAllocation.status == "PUBLISHED",
            )
        )
    ).scalars().first()

    officer_ids: set = set()
    if alloc:
        query = select(DutyAssignment.officer_id).where(DutyAssignment.allocation_id == alloc.id)
        if zone_id:
            query = query.where(DutyAssignment.zone_id == zone_id)
        elif sector_id:
            zone_ids = [z for (z,) in (await db.execute(select(Zone.id).where(Zone.sector_id == sector_id))).all()]
            query = query.where(
                (DutyAssignment.sector_id == sector_id) | (DutyAssignment.zone_id.in_(zone_ids))
            )
        officer_ids = {oid for (oid,) in (await db.execute(query)).all()}

    if not officer_ids:
        fallback = select(User).where(User.role.in_(ENFORCEMENT_ROLES), User.is_active == True)  # noqa: E712
        if zone_id:
            fallback = fallback.where(User.assigned_zone_id == zone_id)
        elif sector_id:
            zone_ids = [z for (z,) in (await db.execute(select(Zone.id).where(Zone.sector_id == sector_id))).all()]
            fallback = fallback.where(User.assigned_zone_id.in_(zone_ids))
        return (await db.execute(fallback)).scalars().all()

    return (
        await db.execute(
            select(User).where(User.id.in_(officer_ids), User.is_active == True)  # noqa: E712
        )
    ).scalars().all()


def _to_response(
    b: Broadcast, recipient_count: int = 0, read_count: int = 0, read_at: Optional[datetime.datetime] = None
) -> BroadcastResponse:
    if b.audience == "SECTOR" and b.sector:
        label = f"Sector {b.sector.code} — {b.sector.name}"
    elif b.audience == "ZONE" and b.zone:
        label = b.zone.name
    elif b.audience == "ALL":
        label = "All officers"
    else:
        label = f"{recipient_count} officer{'s' if recipient_count != 1 else ''}"

    return BroadcastResponse(
        id=b.id,
        subject=b.subject,
        body=b.body,
        priority=b.priority,
        audience=b.audience,
        audience_sector_id=b.audience_sector_id,
        audience_zone_id=b.audience_zone_id,
        audience_label=label,
        sent_by=b.sent_by,
        sent_by_name=b.sender.name if b.sender else None,
        sent_at=b.sent_at,
        recipient_count=recipient_count,
        read_count=read_count,
        read_at=read_at,
    )


@router.post("", response_model=BroadcastResponse, status_code=status.HTTP_201_CREATED)
async def send_broadcast(
    payload: BroadcastCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("send_broadcast")),
):
    audience = payload.audience.upper()
    if audience not in AUDIENCES:
        raise HTTPException(status_code=400, detail=f"audience must be one of {sorted(AUDIENCES)}.")
    priority = payload.priority.upper()
    if priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"priority must be one of {sorted(PRIORITIES)}.")

    sector_id = None
    zone_id = None
    recipients: List[User] = []

    if audience == "ALL":
        recipients = (
            await db.execute(
                select(User).where(User.role.in_(ENFORCEMENT_ROLES), User.is_active == True)  # noqa: E712
            )
        ).scalars().all()
    elif audience == "SECTOR":
        if not payload.sector_id:
            raise HTTPException(status_code=400, detail="sector_id is required for a SECTOR broadcast.")
        sector = (await db.execute(select(Sector).where(Sector.id == payload.sector_id))).scalars().first()
        if not sector:
            raise HTTPException(status_code=404, detail="Sector not found.")
        sector_id = sector.id
        recipients = await _officers_in_scope(db, sector_id=sector.id)
    elif audience == "ZONE":
        if not payload.zone_id:
            raise HTTPException(status_code=400, detail="zone_id is required for a ZONE broadcast.")
        zone = (await db.execute(select(Zone).where(Zone.id == payload.zone_id))).scalars().first()
        if not zone:
            raise HTTPException(status_code=404, detail="Zone not found.")
        zone_id = zone.id
        sector_id = zone.sector_id
        recipients = await _officers_in_scope(db, zone_id=zone.id)
    else:  # OFFICER
        if not payload.officer_ids:
            raise HTTPException(status_code=400, detail="officer_ids is required for an OFFICER broadcast.")
        recipients = (
            await db.execute(select(User).where(User.id.in_(payload.officer_ids)))
        ).scalars().all()
        missing = set(payload.officer_ids) - {o.id for o in recipients}
        if missing:
            raise HTTPException(status_code=404, detail=f"Unknown officer id(s): {', '.join(sorted(missing))}")

    if not recipients:
        # Refused rather than recorded. A broadcast with no recipients looks
        # identical to a delivered one in the sender's outbox, and the
        # commander needs to find out now — while they can still fix the
        # audience — not when nobody turns up.
        raise HTTPException(
            status_code=400,
            detail="No officers match that audience, so nothing was sent. Check the sector/zone has officers posted to it.",
        )

    broadcast = Broadcast(
        id=f"bc-{secrets.token_hex(5)}",
        subject=payload.subject.strip(),
        body=payload.body.strip(),
        priority=priority,
        audience=audience,
        audience_sector_id=sector_id,
        audience_zone_id=zone_id,
        sent_by=current_user.id,
        sent_at=_now(),
    )
    db.add(broadcast)
    await db.flush()

    for officer in recipients:
        db.add(BroadcastRecipient(broadcast_id=broadcast.id, officer_id=officer.id))

    stage_audit_log(
        db, resource_type="broadcast", resource_id=broadcast.id, action="SEND",
        user_id=current_user.id,
        new_values={"audience": audience, "recipients": len(recipients), "priority": priority,
                    "subject": broadcast.subject},
    )
    await db.commit()

    # Live push on top of the durable row — best effort, and deliberately
    # after the commit: an officer who is online gets a toast now, one who
    # is not still has the row waiting when they next open the app.
    for officer in recipients:
        await notify_user(
            officer.id,
            title=("URGENT: " if priority == "URGENT" else "") + broadcast.subject,
            message=broadcast.body,
            level="warning" if priority == "URGENT" else "info",
        )

    refreshed = (
        await db.execute(
            select(Broadcast)
            .options(selectinload(Broadcast.sender), selectinload(Broadcast.sector), selectinload(Broadcast.zone))
            .where(Broadcast.id == broadcast.id)
        )
    ).scalars().first()
    return _to_response(refreshed, recipient_count=len(recipients), read_count=0)


@router.get("", response_model=List[BroadcastResponse])
async def list_sent_broadcasts(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("send_broadcast")),
):
    """A commander's outbox, with delivery and read counts — "did it land"
    is the whole reason this is persisted."""
    broadcasts = (
        await db.execute(
            select(Broadcast)
            .options(selectinload(Broadcast.sender), selectinload(Broadcast.sector), selectinload(Broadcast.zone))
            .order_by(Broadcast.sent_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    counts = dict(
        (
            await db.execute(
                select(BroadcastRecipient.broadcast_id, func.count(BroadcastRecipient.id))
                .group_by(BroadcastRecipient.broadcast_id)
            )
        ).all()
    )
    reads = dict(
        (
            await db.execute(
                select(BroadcastRecipient.broadcast_id, func.count(BroadcastRecipient.id))
                .where(BroadcastRecipient.read_at.isnot(None))
                .group_by(BroadcastRecipient.broadcast_id)
            )
        ).all()
    )

    return [_to_response(b, counts.get(b.id, 0), reads.get(b.id, 0)) for b in broadcasts]


@router.get("/mine", response_model=List[BroadcastResponse])
async def my_broadcasts(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """An officer's own inbox — what was actually sent to them, whether or
    not they were online when it went out."""
    query = (
        select(BroadcastRecipient, Broadcast)
        .join(Broadcast, Broadcast.id == BroadcastRecipient.broadcast_id)
        .options(selectinload(BroadcastRecipient.broadcast))
        .where(BroadcastRecipient.officer_id == current_user.id)
    )
    if unread_only:
        query = query.where(BroadcastRecipient.read_at.is_(None))

    rows = (await db.execute(query.order_by(Broadcast.sent_at.desc()).limit(limit))).all()
    if not rows:
        return []

    broadcast_ids = [b.id for _, b in rows]
    hydrated = {
        b.id: b
        for b in (
            await db.execute(
                select(Broadcast)
                .options(selectinload(Broadcast.sender), selectinload(Broadcast.sector), selectinload(Broadcast.zone))
                .where(Broadcast.id.in_(broadcast_ids))
            )
        ).scalars().all()
    }

    return [_to_response(hydrated[b.id], read_at=recipient.read_at) for recipient, b in rows]


@router.post("/{broadcast_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_broadcast_read(
    broadcast_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipient = (
        await db.execute(
            select(BroadcastRecipient).where(
                BroadcastRecipient.broadcast_id == broadcast_id,
                BroadcastRecipient.officer_id == current_user.id,
            )
        )
    ).scalars().first()
    if not recipient:
        raise HTTPException(status_code=404, detail="That broadcast was not sent to you.")

    # Idempotent: the first read is the one that counts, and a second tab
    # opening the same message must not move the timestamp.
    if recipient.read_at is None:
        recipient.read_at = _now()
        await db.commit()
    return None
