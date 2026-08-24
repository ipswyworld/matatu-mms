import datetime
import json
import logging
from typing import Any, Dict, List

import jwt as pyjwt
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.auth import get_current_user
from app.config import ALGORITHM, SECRET_KEY
from app.database import get_db, AsyncSessionLocal
from app.models import Matatu, User, VehiclePosition, OfficerPosition
from app.realtime import ChannelBroadcaster, get_redis, publish
from app.rbac import ENFORCEMENT_ROLES

logger = logging.getLogger("app.routes.telemetry")
router = APIRouter(prefix="/api/telemetry", tags=["Live Telemetry & GPS Tracking"])

# A vehicle is only considered "live" while its crew's GPS websocket is
# actively streaming. Position state now lives in Redis (key TTL = staleness
# window) instead of a single process's memory, so "is this matatu live"
# means the same thing on every backend instance behind the load balancer —
# not just whichever one the crew app happened to connect to.
STALE_AFTER_SECONDS = 30
TELEMETRY_CHANNEL = "telemetry:broadcast"
TELEMETRY_KEY_PREFIX = "telemetry:vehicle:"

# Same pattern, separate channel/prefix — an officer's live position (§22.4)
# is opt-in per officer (the "On Patrol" toggle in the frontend) and never
# simulated: if the device GPS fix isn't available, nothing is broadcast,
# rather than showing a commander a fake location.
OFFICER_TELEMETRY_CHANNEL = "officer_telemetry:broadcast"
OFFICER_TELEMETRY_KEY_PREFIX = "telemetry:officer:"

broadcaster = ChannelBroadcaster(pattern=TELEMETRY_CHANNEL)
officer_broadcaster = ChannelBroadcaster(pattern=OFFICER_TELEMETRY_CHANNEL)


async def live_vehicles() -> List[Dict[str, Any]]:
    """Vehicles with a non-expired Redis key — Redis's own TTL does the staleness bookkeeping."""
    r = await get_redis()
    vehicles: List[Dict[str, Any]] = []
    async for key in r.scan_iter(match=f"{TELEMETRY_KEY_PREFIX}*"):
        raw = await r.get(key)
        if raw:
            try:
                vehicles.append(json.loads(raw))
            except ValueError:
                continue
    return vehicles


async def update_vehicle(data: Dict[str, Any]) -> None:
    matatu_id = data.get("matatu_id", "m-1")
    r = await get_redis()
    await r.set(f"{TELEMETRY_KEY_PREFIX}{matatu_id}", json.dumps(data, default=str), ex=STALE_AFTER_SECONDS)
    await publish(TELEMETRY_CHANNEL, {"type": "VEHICLE_POSITION_UPDATE", "vehicle": data})
    await _persist_position(matatu_id, data)


async def _persist_position(matatu_id: str, data: Dict[str, Any]) -> None:
    """Durable GPS history, separate from the Redis "live position" key
    above (which only exists for STALE_AFTER_SECONDS). No queue in front of
    this yet (see ARCHITECTURE_DECISIONS.md §3/§13 — Redis Streams + ARQ is
    still a later task), so this is a direct write on every telemetry
    update; fine at current/demo traffic, a real backpressure concern only
    once ingest volume grows. Best-effort: a write failure here must never
    break the live map, which only depends on the Redis/broadcast path above.
    """
    lat, lng = data.get("lat"), data.get("lng")
    if lat is None or lng is None:
        return
    try:
        async with AsyncSessionLocal() as db:
            db.add(VehiclePosition(
                matatu_id=matatu_id,
                lat=float(lat),
                lng=float(lng),
                speed=data.get("speed"),
                heading=data.get("bearing"),
                recorded_at=datetime.datetime.now(datetime.timezone.utc),
            ))
            # Route-deviation check (§1.6/§29.4) — same session/commit as
            # the position write above; best-effort, like everything else
            # in this function (see check_deviation's own docstring).
            from app.deviation import check_deviation
            await check_deviation(db, matatu_id, float(lat), float(lng))
            await db.commit()
    except Exception:
        logger.exception(f"Failed to persist GPS position for matatu {matatu_id}")


async def live_officers() -> List[Dict[str, Any]]:
    """Officers with a non-expired Redis key — same TTL-does-the-bookkeeping pattern as live_vehicles()."""
    r = await get_redis()
    officers: List[Dict[str, Any]] = []
    async for key in r.scan_iter(match=f"{OFFICER_TELEMETRY_KEY_PREFIX}*"):
        raw = await r.get(key)
        if raw:
            try:
                officers.append(json.loads(raw))
            except ValueError:
                continue
    return officers


async def update_officer(data: Dict[str, Any]) -> None:
    officer_id = data["officer_id"]
    r = await get_redis()
    await r.set(f"{OFFICER_TELEMETRY_KEY_PREFIX}{officer_id}", json.dumps(data, default=str), ex=STALE_AFTER_SECONDS)
    await publish(OFFICER_TELEMETRY_CHANNEL, {"type": "OFFICER_POSITION_UPDATE", "officer": data})
    await _persist_officer_position(officer_id, data)


async def _persist_officer_position(officer_id: str, data: Dict[str, Any]) -> None:
    """Durable GPS history for an officer, mirroring _persist_position above.
    Best-effort: a write failure here must never break the live map."""
    lat, lng = data.get("lat"), data.get("lng")
    if lat is None or lng is None:
        return
    try:
        async with AsyncSessionLocal() as db:
            db.add(OfficerPosition(
                officer_id=officer_id,
                lat=float(lat),
                lng=float(lng),
                speed=data.get("speed"),
                heading=data.get("bearing"),
                recorded_at=datetime.datetime.now(datetime.timezone.utc),
            ))
            await db.commit()
    except Exception:
        logger.exception(f"Failed to persist GPS position for officer {officer_id}")


@router.get("/matatus")
async def get_active_telemetry(current_user: User = Depends(get_current_user)):
    """REST fallback endpoint returning live GPS locations of currently-broadcasting Matatus."""
    return await live_vehicles()


@router.get("/officers")
async def get_active_officer_telemetry(current_user: User = Depends(get_current_user)):
    """REST fallback endpoint returning live GPS locations of currently-patrolling officers."""
    return await live_officers()


@router.websocket("/ws/passengers")
async def passenger_telemetry_ws(websocket: WebSocket):
    """WebSocket endpoint for Passenger map clients receiving live GPS broadcasts from any backend instance."""
    await websocket.accept()
    broadcaster.register("*", websocket)
    await websocket.send_text(json.dumps({
        "type": "INIT_TELEMETRY",
        "vehicles": await live_vehicles(),
    }))
    try:
        while True:
            # Keep connection open and listen for ping
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unregister("*", websocket)


@router.websocket("/ws/staff")
async def staff_telemetry_ws(websocket: WebSocket, token: str = "", db: AsyncSession = Depends(get_db)):
    """
    WebSocket endpoint for the staff enforcement live map — vehicle AND
    officer position updates over one connection. Gated to authenticated
    staff (i.e. not PASSENGER/CREW/SACCO_OPERATOR): officer location is
    more sensitive than a bus's, so this isn't left open the way the
    passenger vehicle-only feed is.
    """
    try:
        payload = pyjwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("userId") or payload.get("sub")
    except Exception:
        user_id = None

    user = None
    if user_id:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalars().first()

    if not user or user.role in ("PASSENGER", "CREW", "SACCO_OPERATOR"):
        await websocket.close(code=4401)
        return

    await websocket.accept()
    broadcaster.register("*", websocket)
    officer_broadcaster.register("*", websocket)
    await websocket.send_text(json.dumps({
        "type": "INIT_TELEMETRY",
        "vehicles": await live_vehicles(),
        "officers": await live_officers(),
    }))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unregister("*", websocket)
        officer_broadcaster.unregister("*", websocket)


@router.websocket("/ws/crew/{matatu_id}")
async def crew_telemetry_ws(websocket: WebSocket, matatu_id: str, token: str = "", db: AsyncSession = Depends(get_db)):
    """
    WebSocket endpoint for Driver/Crew apps streaming live GPS telemetry.

    Authenticated and ownership-checked: without this, anyone could connect
    and inject fake positions for any matatu, poisoning the public passenger
    map. Only a CREW (or ADMIN) account tied to the same Sacco that owns
    this matatu may stream to it.
    """
    try:
        payload = pyjwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("userId") or payload.get("sub")
    except Exception:
        user_id = None

    user = None
    if user_id:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalars().first()

    if not user or user.role not in ("CREW", "ADMIN"):
        await websocket.close(code=4401)
        return

    matatu_result = await db.execute(select(Matatu).where(Matatu.id == matatu_id))
    matatu = matatu_result.scalars().first()
    if not matatu:
        await websocket.close(code=4404)
        return
    if user.role == "CREW" and user.sacco_id != matatu.sacco_id:
        logger.warning(f"Crew {user.id} attempted to stream telemetry for a matatu outside their Sacco.")
        await websocket.close(code=4403)
        return

    await websocket.accept()
    logger.info(f"Crew WebSocket streaming connected for Matatu ID {matatu_id} (user {user.id})")
    try:
        while True:
            data_raw = await websocket.receive_text()
            data = json.loads(data_raw)
            data["matatu_id"] = matatu_id  # never trust a client-supplied id over the authenticated/verified one
            await update_vehicle(data)
    except WebSocketDisconnect:
        logger.info(f"Crew WebSocket disconnected for Matatu ID {matatu_id}")


@router.websocket("/ws/officer/{officer_id}")
async def officer_telemetry_ws(websocket: WebSocket, officer_id: str, token: str = "", db: AsyncSession = Depends(get_db)):
    """
    WebSocket endpoint for an enforcement officer's own device streaming
    live GPS while "On Patrol" is toggled on in the frontend.

    Authenticated and self-only: an officer may stream their own position
    (or ADMIN, for testing/support), never someone else's — otherwise any
    authenticated user could impersonate any officer's location on the
    command map.
    """
    try:
        payload = pyjwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("userId") or payload.get("sub")
    except Exception:
        user_id = None

    user = None
    if user_id:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalars().first()

    if not user or user.role not in (*ENFORCEMENT_ROLES, "ADMIN"):
        await websocket.close(code=4401)
        return
    if user.role != "ADMIN" and user.id != officer_id:
        logger.warning(f"User {user.id} attempted to stream telemetry for officer {officer_id}.")
        await websocket.close(code=4403)
        return

    await websocket.accept()
    logger.info(f"Officer WebSocket streaming connected for officer {officer_id}")
    try:
        while True:
            data_raw = await websocket.receive_text()
            data = json.loads(data_raw)
            data["officer_id"] = officer_id
            data["officer_name"] = user.name
            data["role"] = user.role
            await update_officer(data)
    except WebSocketDisconnect:
        logger.info(f"Officer WebSocket disconnected for officer {officer_id}")
