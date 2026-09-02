"""
Named circuit-breaker registry for the ops console (Ops Console Rebuild
Spec §6.1).

Circuit breakers already existed in this codebase, but only as an anonymous
per-webhook-subscription dict inside app/listeners.py — reachable by the
delivery code and by nothing else. An operator could neither see that a
breaker had tripped nor do anything about it.

This registry adds the missing half: breakers register themselves under a
stable name, the console lists their live state, and an operator can force
one open (stop hammering a third party that is known to be down) or force
it closed (resume immediately after a transient blip, without waiting out
the recovery timer).

State lives in-process, deliberately. A breaker guards *this* process's
calls to a dependency, so a per-process view is the accurate one; a shared
Redis-backed breaker would let one replica's bad luck block every other
replica's healthy connections. The trade is that an override applies to the
replica that received it — acceptable while overrides are a short-lived
incident tool, and called out here so it is a known property rather than a
surprise.
"""
import logging
from typing import Dict, List, Optional

from app.resilience import CircuitBreaker

logger = logging.getLogger("app.ops_breakers")

_registry: Dict[str, CircuitBreaker] = {}
_descriptions: Dict[str, str] = {}


def register(name: str, breaker: CircuitBreaker, description: str = "") -> CircuitBreaker:
    """Registers (or returns an already-registered) breaker under `name`.

    Idempotent so call sites can register on every use without needing to
    track whether they were first.
    """
    existing = _registry.get(name)
    if existing is not None:
        return existing
    _registry[name] = breaker
    if description:
        _descriptions[name] = description
    return breaker


def get_or_create(name: str, *, failure_threshold: int = 3, recovery_time: float = 30.0,
                  description: str = "") -> CircuitBreaker:
    """Convenience for call sites that just want a named breaker."""
    existing = _registry.get(name)
    if existing is not None:
        return existing
    return register(name, CircuitBreaker(failure_threshold, recovery_time), description)


def get(name: str) -> Optional[CircuitBreaker]:
    return _registry.get(name)


def snapshot() -> List[dict]:
    """Live state of every registered breaker, for the console and the
    metrics stream."""
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
            # What callers actually experience right now, which is what an
            # operator is really asking when they look at this list.
            "effectivelyBlocking": (
                breaker.override == "open"
                or (breaker.override == "auto" and breaker.state == "OPEN")
            ),
        })
    return out


def set_override(name: str, override: str) -> CircuitBreaker:
    """Applies a manual override. Raises KeyError if the breaker is unknown
    and ValueError if the override is not one of auto/open/closed."""
    if override not in ("auto", "open", "closed"):
        raise ValueError("Override must be one of: auto, open, closed")
    breaker = _registry.get(name)
    if breaker is None:
        raise KeyError(name)
    breaker.override = override
    logger.warning("Circuit breaker %r override set to %r by an operator", name, override)
    return breaker
