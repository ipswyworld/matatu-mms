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
from app.models import Matatu, User, VehiclePosition
from app.realtime import ChannelBroadcaster, get_redis, publish

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

broadcaster = ChannelBroadcaster(pattern=TELEMETRY_CHANNEL)


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


@router.get("/matatus")
async def get_active_telemetry(current_user: User = Depends(get_current_user)):
    """REST fallback endpoint returning live GPS locations of currently-broadcasting Matatus."""
    return await live_vehicles()


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
