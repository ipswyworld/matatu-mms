import asyncio
import json
import logging
from typing import Optional

import redis.asyncio as aioredis

from app.config import REDIS_URL

logger = logging.getLogger("app.realtime")

_redis: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    """
    Shared async Redis connection for this process. Used as the real-time
    backbone: every backend instance publishes here instead of only
    fanning out to its own in-memory websocket list, so live GPS,
    dashboard-refresh, and per-user notifications correctly reach clients
    connected to *any* instance once this runs behind a load balancer —
    not just the one that happened to receive the write.
    """
    global _redis
    if _redis is None:
        # protocol=2 (RESP2) avoids the RESP3 HELLO handshake the client
        # otherwise tries first — required for Redis <6.0. Modern Redis
        # (6.0+) supports both, so this is safe either way.
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True, protocol=2)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


async def publish(channel: str, payload: dict) -> None:
    """Fire-and-forget broadcast — publish and move on, don't block the caller on delivery."""
    try:
        r = await get_redis()
        await r.publish(channel, json.dumps(payload, default=str))
    except Exception:
        logger.warning("Redis publish to %s failed — real-time fan-out degraded for this event", channel, exc_info=True)


class ChannelBroadcaster:
    """
    Generic pattern: N websocket clients connected to *this* process want to
    receive whatever gets published to a Redis channel (or channel pattern),
    regardless of which process actually published it. One background
    subscriber task per broadcaster, started once at app startup.

    `key_fn` extracts a routing key from the raw Redis channel name (e.g.
    the user_id suffix on a personalized notification channel) so a single
    broadcaster can serve many independent "rooms" — like per-user
    notifications — without one subscriber task per user.
    """

    def __init__(self, pattern: str, key_fn=None):
        self.pattern = pattern
        self.key_fn = key_fn or (lambda channel: "*")
        self._connections: dict[str, list] = {}
        self._task: Optional[asyncio.Task] = None

    def register(self, key: str, websocket) -> None:
        self._connections.setdefault(key, []).append(websocket)

    def unregister(self, key: str, websocket) -> None:
        conns = self._connections.get(key)
        if conns and websocket in conns:
            conns.remove(websocket)
            if not conns:
                self._connections.pop(key, None)

    async def _run(self) -> None:
        r = await get_redis()
        pubsub = r.pubsub()
        await pubsub.psubscribe(self.pattern)
        logger.info("ChannelBroadcaster subscribed to %s", self.pattern)
        try:
            async for message in pubsub.listen():
                if message.get("type") != "pmessage":
                    continue
                channel = message["channel"]
                key = self.key_fn(channel)
                targets = list(self._connections.get(key, []))
                if key != "*":
                    targets += self._connections.get("*", [])
                if not targets:
                    continue
                data = message["data"]
                dead = []
                for ws in targets:
                    try:
                        await ws.send_text(data)
                    except Exception:
                        dead.append(ws)
                for ws in dead:
                    self.unregister(key, ws)
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.punsubscribe(self.pattern)
            await pubsub.aclose()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None
