"""
Per-client API quotas (Readiness List §14).

The IP-keyed limiter in app/rate_limit.py is the wrong instrument for
partner traffic: a Sacco's integration calls from one server, so per-IP and
per-client happen to coincide until they don't — a partner behind a NAT, a
partner that scales to several instances, or two partners on the same cloud
provider egress IP all break the assumption in different directions.

Quotas are keyed on the client identity instead, and tiered, because an
internal first-party system and an unknown third-party integrator have no
business sharing a limit.

Failure is open, deliberately: if Redis is unreachable the request proceeds.
A quota is a fairness and cost control, not a security boundary — the
security boundary is the scope check that already ran. Turning a cache
outage into a partner-wide outage would trade a small problem for a large one.
"""
import datetime
import logging
import time
from typing import Optional

from fastapi import HTTPException, Request, status

logger = logging.getLogger("app.quota")

KEY_PREFIX = "api:quota:"
_PERIOD_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}

# Separate from KEY_PREFIX's fixed-window rate-limit counters, which expire
# within seconds/minutes by design (window + 5s TTL) — there is nothing to
# read back for a usage-history graph from those. This is a second, coarser
# counter kept for 35 days specifically so the ops console can show a real
# 30-day trend, not the current instant only.
DAILY_KEY_PREFIX = "api:usage:daily:"
DAILY_TTL_SECONDS = 35 * 86400


def _limit_for(principal) -> tuple[int, int]:
    """Returns (max_requests, window_seconds) for this principal's tier."""
    from app.api_clients import DEFAULT_TIER, QUOTA_TIERS
    from app.ops_limits import parse_limit

    tier = getattr(principal, "tier", DEFAULT_TIER)
    raw = QUOTA_TIERS.get(tier) or QUOTA_TIERS[DEFAULT_TIER]
    try:
        count, period = parse_limit(raw)
        return count, _PERIOD_SECONDS.get(period, 60)
    except Exception:
        return 600, 60


async def enforce_quota(principal, request: Optional[Request] = None) -> None:
    """Counts one request against a machine principal's quota, and enforces
    that principal's own IP allowlist if it has one.

    Human callers are unaffected: they are already governed by the per-IP
    limiter and their own role, and double-charging them against a partner
    quota would throttle the console for no reason.
    """
    from app.principals import is_machine

    if not is_machine(principal):
        return

    # Per-partner-client IP restriction — separate from the global
    # OPS_IP_ALLOWLIST (network_gate.py, which gates the whole ops control
    # plane); this is one client's own allowlist, checked here since
    # enforce_quota already runs on every partner request.
    from app import network_gate

    client_host = request.client.host if request and request.client else None
    if not network_gate.client_ip_allowed(client_host, getattr(principal, "ip_allowlist", None)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This client's credentials are not authorized from this IP address.",
        )

    from app.realtime import get_redis

    # Daily counter for the usage-history graph — separate key from the
    # fixed-window counter below, kept 35 days instead of expiring within
    # the rate-limit window.
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    try:
        r = await get_redis()
        await r.incr(f"{DAILY_KEY_PREFIX}{principal.client_id}:{today}")
        await r.expire(f"{DAILY_KEY_PREFIX}{principal.client_id}:{today}", DAILY_TTL_SECONDS)
    except Exception as e:
        logger.warning("Daily usage counter skipped (Redis unavailable): %s", e)

    max_requests, window = _limit_for(principal)
    # Fixed windows rather than a sliding log: one INCR and one EXPIRE per
    # request, versus storing a timestamp per request per client. At partner
    # volumes the precision difference is irrelevant and the cost difference
    # is not.
    bucket = int(time.time()) // window
    key = f"{KEY_PREFIX}{principal.client_id}:{bucket}"

    try:
        r = await get_redis()
        count = await r.incr(key)
        if count == 1:
            await r.expire(key, window + 5)
    except Exception as e:
        logger.warning("Quota check skipped (Redis unavailable): %s", e)
        return

    if count > max_requests:
        retry_after = window - (int(time.time()) % window)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"API quota exceeded for this client: {max_requests} requests "
                f"per {window} seconds ({principal.tier} tier)."
            ),
            headers={
                "Retry-After": str(retry_after),
                "X-RateLimit-Limit": str(max_requests),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(int(time.time()) + retry_after),
            },
        )


async def current_usage(client_id: str, tier: str) -> dict:
    """Usage in the current window, for the ops console."""
    from app.api_clients import QUOTA_TIERS
    from app.ops_limits import parse_limit
    from app.realtime import get_redis

    try:
        count_limit, period = parse_limit(QUOTA_TIERS.get(tier, "600/minute"))
        window = _PERIOD_SECONDS.get(period, 60)
    except Exception:
        count_limit, window = 600, 60

    bucket = int(time.time()) // window
    try:
        r = await get_redis()
        raw = await r.get(f"{KEY_PREFIX}{client_id}:{bucket}")
        used = int(raw) if raw else 0
    except Exception:
        used = 0

    return {"used": used, "limit": count_limit, "windowSeconds": window}


async def usage_history(client_id: str, days: int = 30) -> list[dict]:
    """Real daily request counts for the last `days` days, from the
    DAILY_KEY_PREFIX counters enforce_quota() writes on every request —
    not fabricated, and not derived from the fixed-window rate-limit
    counters (those expire within seconds/minutes by design)."""
    from app.realtime import get_redis

    try:
        r = await get_redis()
    except Exception:
        return []

    out: list[dict] = []
    today = datetime.datetime.now(datetime.timezone.utc).date()
    for offset in range(days - 1, -1, -1):
        day = today - datetime.timedelta(days=offset)
        key = f"{DAILY_KEY_PREFIX}{client_id}:{day.isoformat()}"
        try:
            raw = await r.get(key)
        except Exception:
            raw = None
        out.append({"date": day.isoformat(), "requests": int(raw) if raw else 0})
    return out
