import logging
import jwt as pyjwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import SECRET_KEY, ALGORITHM
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


def _user_id_from_channel(channel: str) -> str:
    return channel.split(":", 1)[1] if ":" in channel else channel


broadcaster = ChannelBroadcaster(pattern=NOTIFY_CHANNEL_PATTERN, key_fn=_user_id_from_channel)


async def notify_user(user_id: str, title: str, message: str, level: str = "info", **extra) -> None:
    """
    Call this from any route to push a real-time, name-addressed
    notification to a specific logged-in user. Delivery is best-effort —
    if they're not connected right now, the toast is simply missed (this is
    a live nudge, not a durable inbox; pair with an email/SMS for anything
    that must not be missed).
    """
    await publish(f"notify:{user_id}", {
        "type": "NOTIFICATION",
        "title": title,
        "message": message,
        "level": level,
        **extra,
    })


def _decode_user_id(token: str) -> str | None:
    try:
        payload = pyjwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("userId") or payload.get("sub")
    except Exception:
        return None


@router.websocket("/ws")
async def personal_notifications_ws(websocket: WebSocket, token: str = ""):
    """Each user connects to their own feed — nothing broadcast here is ever visible to another user."""
    user_id = _decode_user_id(token)
    if not user_id:
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
