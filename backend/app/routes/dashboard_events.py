import logging
import jwt as pyjwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import SECRET_KEY, ALGORITHM
from app.events import dispatcher
from app.realtime import ChannelBroadcaster, publish

logger = logging.getLogger("app.routes.dashboard_events")
router = APIRouter(prefix="/api/events", tags=["Dashboard Live Updates"])

# Events that should nudge any open dashboard to refresh. This channel carries
# no data of its own — connected clients just re-fetch their already
# role-scoped REST data on receiving a ping, so there's nothing to leak by
# broadcasting to every connected socket regardless of role.
DASHBOARD_RELEVANT_EVENTS = {
    "BOOKING_CREATED",
    "BOOKING_STATUS_CHANGED",
    "FINE_ISSUED",
    "FINE_STATUS_CHANGED",
    "VEHICLE_STATUS_CHANGED",
    "SACCO_LICENSE_RENEWAL_SUBMITTED",
    "SACCO_LICENSE_RENEWAL_DECIDED",
    # Enforcement case lifecycle — without these, a newly filed case (or a
    # payment/release/waiver on an existing one) never nudges an open
    # admin/enforcement dashboard; it only shows up on the next manual
    # reload. Dispatched from routes/enforcement_cases.py.
    "ENFORCEMENT_CASE_FILED",
    "ENFORCEMENT_FINE_PAID",
    "ENFORCEMENT_CASE_RELEASED",
    "ENFORCEMENT_CASE_DISPUTED",
    "ENFORCEMENT_CASE_WAIVED",
    # Crew "Send Rapid Incident Alert" (routes/activity.py) — without this,
    # an incident a crew member reports never nudges an open admin
    # dashboard, only the Sacco operator's own notification toast.
    "CREW_INCIDENT_ALERT",
}

DASHBOARD_CHANNEL = "dashboard:broadcast"
broadcaster = ChannelBroadcaster(pattern=DASHBOARD_CHANNEL)


async def broadcast_dashboard_update_listener(event_type: str, data: dict):
    """
    Publishes to Redis rather than iterating an in-process connection list —
    every backend instance's own ChannelBroadcaster picks this up and fans
    out to whichever dashboards happen to be connected to *it*, so the ping
    reaches every open dashboard regardless of which instance served the
    request that triggered the event.
    """
    if event_type in DASHBOARD_RELEVANT_EVENTS:
        await publish(DASHBOARD_CHANNEL, {"type": "DASHBOARD_UPDATE", "event": event_type})


def register_dashboard_broadcast_listeners():
    for event_type in DASHBOARD_RELEVANT_EVENTS:
        dispatcher.register(event_type, broadcast_dashboard_update_listener)


def _token_is_valid(token: str) -> bool:
    try:
        pyjwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return True
    except Exception:
        return False


@router.websocket("/ws/dashboard")
async def dashboard_live_updates_ws(websocket: WebSocket, token: str = ""):
    """
    Any authenticated dashboard subscribes here and gets a lightweight ping
    whenever a booking, fine, vehicle status, or Sacco license event fires
    anywhere in the system. Clients re-fetch their own role-scoped REST data
    on receiving it — this socket carries no data itself.
    """
    if not _token_is_valid(token):
        # A custom close code can only travel over a real close frame, which
        # requires the handshake to have completed — closing before accept()
        # collapses to a generic HTTP 403 and silently drops the intended
        # 4401 signal. Accept first so the code actually reaches the client.
        await websocket.accept()
        await websocket.close(code=4401)
        return

    await websocket.accept()
    broadcaster.register("*", websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unregister("*", websocket)
