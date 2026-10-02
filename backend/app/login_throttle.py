"""
Per-account login throttling (Production Readiness List §4).

The per-IP limiter in app/rate_limit.py is a coarse net: it stops one host
hammering the login endpoint, but it cannot stop credential stuffing spread
across many source IPs, and it punishes everyone behind a shared NAT for one
attacker's behaviour. This is the complementary control — bounded attempts
against a *single account*, regardless of where they come from.

Two deliberate design choices:

  * **Failures are counted, successes are not.** A legitimate user signing
    in repeatedly (several devices, a flaky connection, a shared kiosk) is
    not an attack and must not be throttled. Credential stuffing, by
    definition, produces failures. Counting all attempts would punish the
    honest case and barely inconvenience the attack.

  * **A successful login clears the counter.** Otherwise a user who
    mistyped their password four times would stay penalised after getting
    it right, which is exactly when the system should get out of their way.

This is not implemented as a slowapi `key_func` because slowapi calls key
functions synchronously and the identifier lives in the request body, which
can only be read with an await. Doing it explicitly inside the endpoint is
both possible and clearer about what is counted.
"""
import logging
from typing import Optional

logger = logging.getLogger("app.login_throttle")

KEY_PREFIX = "auth:login_fail:"

# Window in seconds that failures are remembered for. Deliberately longer
# than the per-IP window: credential stuffing is patient, and a one-minute
# memory would let an attacker simply pace themselves.
WINDOW_SECONDS = 900  # 15 minutes

_PERIOD_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def normalize(identifier: str) -> str:
    """Same normalisation the login lookup uses, so "USER@X.COM" and
    "user@x.com" share one counter rather than getting one each."""
    return (identifier or "").strip().lower()


def _limit() -> int:
    """Max failures per account per window, from the live rate-limit store
    so it is tunable from the ops console like every other limit."""
    from app import ops_limits
    try:
        count, _period = ops_limits.parse_limit(ops_limits.limit_for("auth_login_per_account"))
        return count
    except Exception:
        return 10


def _window_seconds() -> int:
    from app import ops_limits
    try:
        _count, period = ops_limits.parse_limit(ops_limits.limit_for("auth_login_per_account"))
        return _PERIOD_SECONDS.get(period, WINDOW_SECONDS)
    except Exception:
        return WINDOW_SECONDS


async def failure_count(identifier: str) -> int:
    from app.realtime import get_redis
    try:
        r = await get_redis()
        raw = await r.get(f"{KEY_PREFIX}{normalize(identifier)}")
        return int(raw) if raw else 0
    except Exception as e:
        # Redis being unavailable must never block logins outright — that
        # would turn a cache outage into a total authentication outage. The
        # per-IP limiter still applies.
        logger.warning("Login throttle read failed, allowing attempt: %s", e)
        return 0


async def is_locked(identifier: str) -> bool:
    return await failure_count(identifier) >= _limit()


async def record_failure(identifier: str) -> int:
    """Counts one failed attempt against this account. Returns the new count."""
    from app.realtime import get_redis
    key = f"{KEY_PREFIX}{normalize(identifier)}"
    try:
        r = await get_redis()
        count = await r.incr(key)
        # Set the expiry only on first failure so the window is fixed from
        # the first bad attempt rather than sliding forward with each one —
        # a sliding window would let a slow attacker hold an account locked
        # indefinitely.
        if count == 1:
            await r.expire(key, _window_seconds())
        return int(count)
    except Exception as e:
        logger.warning("Login throttle write failed: %s", e)
        return 0


async def clear(identifier: str) -> None:
    """Called on successful authentication."""
    from app.realtime import get_redis
    try:
        r = await get_redis()
        await r.delete(f"{KEY_PREFIX}{normalize(identifier)}")
    except Exception as e:
        logger.debug("Login throttle clear failed: %s", e)


async def retry_after_seconds(identifier: str) -> Optional[int]:
    from app.realtime import get_redis
    try:
        r = await get_redis()
        ttl = await r.ttl(f"{KEY_PREFIX}{normalize(identifier)}")
        return int(ttl) if ttl and ttl > 0 else None
    except Exception:
        return None
