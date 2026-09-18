import datetime
import logging
import uuid

import jwt as pyjwt
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import SECRET_KEY, ALGORITHM
from app.database import get_db, AsyncSessionLocal
from app.models import Notification, User
from app.schemas import NotificationHistoryResponse
from app.auth import get_current_user
from app.realtime import ChannelBroadcaster, publish

logger = logging.getLogger("app.routes.notifications")
router = APIRouter(prefix="/api/notifications", tags=["Personalized Notifications"])

# One Redis channel per user (notify:{userId}), fanned out through the same
# ChannelBroadcaster pattern as telemetry/dashboard — a personalized event
# reaches that specific user's open tab(s) regardless of which backend
# instance handled the request that triggered it. This is what makes
# name-addressed, real-time UX ("Hi Daniel, your Sacco was approved") work
# the same way whether there's one backend instance or twenty.
NOTIFY_CHANNEL_PATTERN = "notify:*"

# How much history a page load fetches. Deliberately generous relative to
# the bell's own display cap — the count and the list both need to reflect
# reality, not just "the last few".
HISTORY_LIMIT = 50


def _user_id_from_channel(channel: str) -> str:
    return channel.split(":", 1)[1] if ":" in channel else channel


broadcaster = ChannelBroadcaster(pattern=NOTIFY_CHANNEL_PATTERN, key_fn=_user_id_from_channel)


async def notify_user(user_id: str, title: str, message: str, level: str = "info", **extra) -> None:
    """
    Call this from any route to push a real-time, name-addressed
    notification to a specific logged-in user.

    Persisted first, published second: the live WebSocket push is still
    best-effort (a closed browser simply misses the toast), but the row
    written here means the next page load — or the next time the bell is
    opened — shows it anyway. Uses its own short-lived session rather
    than the caller's `db`, deliberately: call sites span both
    before-commit and after-commit points in their own transactions, and
    a notification's durability shouldn't depend on which one a given
    caller happens to use.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    notification_id = f"notif-{uuid.uuid4().hex[:12]}"
    try:
        async with AsyncSessionLocal() as session:
            session.add(Notification(
                id=notification_id,
                user_id=user_id,
                title=title,
                message=message,
                level=level,
                created_at=now,
            ))
            await session.commit()
    except Exception:
        # A failure to persist shouldn't also cancel the live push below —
        # the two are independent best-effort/durable halves of the same
        # feature, not a single all-or-nothing transaction.
        logger.warning("Failed to persist notification for user %s", user_id, exc_info=True)

    await publish(f"notify:{user_id}", {
        "type": "NOTIFICATION",
        "id": notification_id,
        "title": title,
        "message": message,
        "level": level,
        "createdAt": now.isoformat(),
        **extra,
    })


def _decode_user_id(token: str) -> str | None:
    try:
        from app.auth import JWT_AUDIENCE
        payload = pyjwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE)
        return payload.get("userId") or payload.get("sub")
    except Exception:
        return None


@router.get("", response_model=NotificationHistoryResponse)
async def get_notification_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """What the bell shows on page load — real history, not just whatever
    arrived over the WebSocket during this browser session."""
    items_result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(HISTORY_LIMIT)
    )
    unread_result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id, Notification.read_at.is_(None)
        )
    )
    return NotificationHistoryResponse(
        items=items_result.scalars().all(),
        unread_count=unread_result.scalar() or 0,
    )


@router.post("/read", response_model=NotificationHistoryResponse)
async def mark_notifications_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Marks every currently-unread notification as read — called when the
    bell dropdown is opened. This is genuinely different from the old
    behavior it replaces (a client-side counter reset with nothing
    written anywhere): the badge now reflects a real, persisted read
    state, so it stays correct across reconnects and page loads instead
    of silently zeroing itself the instant you glance at it."""
    now = datetime.datetime.now(datetime.timezone.utc)
    await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.read_at.is_(None))
        .values(read_at=now)
    )
    await db.commit()
    return await get_notification_history(current_user=current_user, db=db)


@router.websocket("/ws")
async def personal_notifications_ws(websocket: WebSocket, token: str = ""):
    """Each user connects to their own feed — nothing broadcast here is ever visible to another user."""
    user_id = _decode_user_id(token)
    if not user_id:
        # A custom close code only travels over a real close frame, which
        # requires the handshake to have completed — closing before accept()
        # collapses to a generic HTTP 403 and silently drops the intended
        # 4401 signal (verified directly: an invalid token here previously
        # surfaced as a bare 403 at the wire level, not code 4401).
        await websocket.accept()
        await websocket.close(code=4401)
        return

    await websocket.accept()
    broadcaster.register(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unregister(user_id, websocket)
