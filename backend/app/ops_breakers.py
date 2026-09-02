"""
Named circuit-breaker registry for the ops console (Ops Console Rebuild
Spec §6.1), with Redis-backed manual overrides.

Circuit breakers already existed in this codebase, but only as an anonymous
per-webhook-subscription dict inside app/listeners.py — reachable by the
delivery code and by nothing else. An operator could neither see that a
breaker had tripped nor do anything about it.

Cross-process design (changed by Phase 4):
  * Breaker *state* (CLOSED/OPEN/HALF-OPEN, failure counts) stays
    per-process and is published to Redis for visibility, because a
    breaker guards one process's own calls to a dependency. A shared
    tripped state would let one replica's bad luck block every other
    replica's healthy connections.
  * Breaker *overrides* live in Redis, because the whole point of an
    override is that an operator sets it somewhere else — the ops console,
    or after Phase 4 an entirely separate control-plane process — and it
    has to take effect in the processes actually making the calls. An
    in-process override would have silently done nothing once the control
    plane was split out.

Override propagation is therefore eventually-consistent with a bounded lag
of REFRESH_INTERVAL_SECONDS, same trade as app/ops_limits.py and for the
same reason: CircuitBreaker.call() is on the hot path and cannot await a
Redis round trip per call.
"""
import asyncio
import json
import logging
import os
import socket
import time
from typing import Dict, List, Optional

from app.resilience import CircuitBreaker

logger = logging.getLogger("app.ops_breakers")

OVERRIDES_KEY = "ops:breaker_overrides"
STATE_KEY_PREFIX = "ops:breaker_state:"
STATE_TTL_SECONDS = 20
REFRESH_INTERVAL_SECONDS = 5

# Identifies this process in the published state so the console can show
# per-replica breaker state rather than silently showing one at random.
INSTANCE_ID = f"{socket.gethostname()}:{os.getpid()}"

_registry: Dict[str, CircuitBreaker] = {}
_descriptions: Dict[str, str] = {}
_overrides: Dict[str, str] = {}
_refresh_task: Optional[asyncio.Task] = None


def _apply_override_to(name: str, breaker: CircuitBreaker) -> None:
    breaker.override = _overrides.get(name, "auto")


def register(name: str, breaker: CircuitBreaker, description: str = "") -> CircuitBreaker:
    """Registers (or returns an already-registered) breaker under `name`.

    Idempotent so call sites can register on every use without tracking
    whether they were first.
    """
    existing = _registry.get(name)
    if existing is not None:
        return existing
    _registry[name] = breaker
    if description:
        _descriptions[name] = description
    # A breaker registered after an override was set must adopt it, or an
    # operator's "hold this open" would silently lapse the first time the
    # guarded code path created its breaker.
    _apply_override_to(name, breaker)
    return breaker


def get_or_create(name: str, *, failure_threshold: int = 3, recovery_time: float = 30.0,
                  description: str = "") -> CircuitBreaker:
    existing = _registry.get(name)
    if existing is not None:
        return existing
    return register(name, CircuitBreaker(failure_threshold, recovery_time), description)


def get(name: str) -> Optional[CircuitBreaker]:
    return _registry.get(name)


def _local_snapshot() -> List[dict]:
    out: List[dict] = []
    for name, breaker in sorted(_registry.items()):
        out.append({
            "name": name,
            "description": _descriptions.get(name, ""),
            "state": breaker.state,
            "override": breaker.override,
            "failureCount": breaker.failure_count,
            "failureThreshold": breaker.failure_threshold,
            "recoveryTime": breaker.recovery_time,
            "instance": INSTANCE_ID,
            "effectivelyBlocking": (
                breaker.override == "open"
                or (breaker.override == "auto" and breaker.state == "OPEN")
            ),
        })
    return out


def snapshot() -> List[dict]:
    """This process's own breakers. Used directly when the control plane is
    not split out; see snapshot_cluster() for the split deployment."""
    return _local_snapshot()


async def snapshot_cluster() -> List[dict]:
    """Every process's breakers, read from Redis.

    A control-plane process makes no webhook calls of its own, so its local
    registry is empty — without this it would report "no breakers
    registered" while the app processes had tripped ones.
    """
    from app.realtime import get_redis
    merged: List[dict] = []
    seen_local = {b["name"] for b in _local_snapshot()}
    merged.extend(_local_snapshot())
    try:
        r = await get_redis()
        keys = await r.keys(f"{STATE_KEY_PREFIX}*")
        for key in keys:
            raw = await r.get(key)
            if not raw:
                continue
            for entry in json.loads(raw):
                # Don't double-report this process's own breakers.
                if entry.get("instance") == INSTANCE_ID and entry["name"] in seen_local:
                    continue
                # Overrides are authoritative from Redis, so reflect the
                # current one rather than whatever that replica last published.
                entry["override"] = _overrides.get(entry["name"], "auto")
                entry["effectivelyBlocking"] = (
                    entry["override"] == "open"
                    or (entry["override"] == "auto" and entry.get("state") == "OPEN")
                )
                merged.append(entry)
    except Exception as e:
        logger.debug("Could not read cluster breaker state: %s", e)
    merged.sort(key=lambda b: (b["name"], b.get("instance", "")))
    return merged


async def publish_state() -> None:
    """Publishes this process's breaker state with a short TTL, so a replica
    that dies stops appearing in the console rather than lingering as a
    ghost."""
    if not _registry:
        return
    from app.realtime import get_redis
    try:
        r = await get_redis()
        await r.set(
            f"{STATE_KEY_PREFIX}{INSTANCE_ID}",
            json.dumps(_local_snapshot()),
            ex=STATE_TTL_SECONDS,
        )
    except Exception as e:
        logger.debug("Could not publish breaker state: %s", e)


async def load_overrides() -> None:
    from app.realtime import get_redis
    global _overrides
    try:
        r = await get_redis()
        raw = await r.get(OVERRIDES_KEY)
        _overrides = json.loads(raw) if raw else {}
    except Exception as e:
        logger.debug("Could not load breaker overrides: %s", e)
        return
    for name, breaker in _registry.items():
        _apply_override_to(name, breaker)


async def set_override(name: str, override: str) -> None:
    """Applies a manual override cluster-wide.

    Unlike the local registry, this deliberately accepts a name that is not
    registered in *this* process: the control plane never creates webhook
    breakers itself, so requiring local registration would make every
    override from a split control plane fail.
    """
    if override not in ("auto", "open", "closed"):
        raise ValueError("Override must be one of: auto, open, closed")

    from app.realtime import get_redis
    if override == "auto":
        _overrides.pop(name, None)
    else:
        _overrides[name] = override

    breaker = _registry.get(name)
    if breaker is not None:
        _apply_override_to(name, breaker)

    r = await get_redis()
    await r.set(OVERRIDES_KEY, json.dumps(_overrides))
    logger.warning("Circuit breaker %r override set to %r by an operator", name, override)


async def known_names() -> List[str]:
    """Every breaker name the cluster has published or been overridden for —
    what the console offers as override targets."""
    names = set(_registry.keys()) | set(_overrides.keys())
    for entry in await snapshot_cluster():
        names.add(entry["name"])
    return sorted(names)


async def _refresh_loop() -> None:
    while True:
        try:
            await asyncio.sleep(REFRESH_INTERVAL_SECONDS)
            await load_overrides()
            await publish_state()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug("Breaker refresh skipped: %s", e)


def start_refresh_task() -> None:
    global _refresh_task
    if _refresh_task is None:
        _refresh_task = asyncio.create_task(_refresh_loop())


def stop_refresh_task() -> None:
    global _refresh_task
    if _refresh_task is not None:
        _refresh_task.cancel()
        _refresh_task = None
