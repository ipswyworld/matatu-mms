"""
Live-adjustable rate limits (Ops Console Rebuild Spec §6.1).

Why this exists: rate limits used to be decorator literals
(`@limiter.limit("30/minute")`), which meant changing one in production was
an edit-commit-push-redeploy cycle. That is far too slow a loop for a live
limit — this project hit exactly that problem when a shared-office IP kept
tripping the login limiter during a demo and the only fix was a code change.

Design:
  * Postgres is the source of truth (RateLimitOverride), so a change
    survives a Redis flush and is audited like any other config write.
  * Redis mirrors it, so every replica converges without hammering the DB.
  * A module-level dict is the actual read path, because slowapi's limit
    callable is synchronous and runs on every request — it cannot await.

Propagation is therefore eventually-consistent with a bounded lag of
REFRESH_INTERVAL_SECONDS across replicas, and immediate on the replica that
handled the write. That is the right trade for a rate limit: a few seconds
of skew is harmless, blocking the request path on a DB read is not.
"""
import asyncio
import os
import json
import logging
from typing import Dict, Optional

logger = logging.getLogger("app.ops_limits")

REDIS_KEY = "ops:rate_limits"
REFRESH_INTERVAL_SECONDS = 10

# Every adjustable limit, with the value used when nothing has been
# overridden. Scope names are stable identifiers — they are what the ops
# console PATCHes and what the audit trail records, so renaming one is a
# breaking change, not a cosmetic edit.
# These MUST match the literals they replaced exactly — this refactor is
# behaviour-preserving by construction, so that moving limits into a store
# cannot itself change how the system behaves.
# The login limit is environment-aware, and this is the one exception to the
# behaviour-preserving rule above.
#
# 100/minute was a deliberate demo relaxation: groups of people showing the
# system from one shared office IP kept locking each other out. That reason
# does not survive contact with production, where the same generosity is
# just a wider brute-force window — and a demo-era value silently becoming
# the production default is exactly how a temporary loosening becomes
# permanent.
#
# Production tightens to 30/minute per IP. That is safe now in a way it was
# not before: app/login_throttle.py adds a per-ACCOUNT limit that catches
# credential stuffing spread across many IPs, which is the attack the per-IP
# number was being stretched to cover. The two controls together are
# stronger than either at any single value.
#
# APP_ENV=production selects it; anything else keeps the demo value.
_IS_PRODUCTION = os.getenv("APP_ENV", "").strip().lower() in ("production", "prod")

DEFAULTS: Dict[str, str] = {
    "auth_login": "30/minute" if _IS_PRODUCTION else "100/minute",
    # Failed sign-ins tolerated against ONE account before it is temporarily
    # locked, regardless of source IP (app/login_throttle.py). The period is
    # the memory window, not a rate: 10/hour means ten failures within a
    # 15-minute-to-an-hour window, cleared by any successful sign-in.
    "auth_login_per_account": "10/hour",
    "auth_register": "15/minute",
    "auth_refresh": "30/minute",
    "auth_verify_mfa": "20/minute",
    "auth_forgot_password": "10/minute",
    "auth_reset_password": "20/minute",
    "auth_forgot_password_phone": "10/minute",
    "auth_reset_password_phone": "20/minute",
    # Token exchange for the partner API. Tight: a client fetches a token
    # once an hour, so anything above this is a misbehaving integration
    # or credential probing.
    "oauth_token": "20/minute",
    "bookings_create": "20/minute",
    "payments_callback": "60/minute",
}

# Human-readable description per scope, surfaced in the ops console so an
# operator changing a number knows what it actually governs.
DESCRIPTIONS: Dict[str, str] = {
    "auth_login": "Sign-in attempts per IP. Raising this weakens brute-force protection.",
    "auth_login_per_account": "Failed sign-ins against one account before it locks, from any IP. Defends credential stuffing spread across many sources.",
    "auth_register": "New account registrations per IP.",
    "auth_refresh": "Token refreshes per IP. Clients refresh proactively before expiry.",
    "auth_verify_mfa": "MFA code submissions per IP.",
    "auth_forgot_password": "Password-reset requests per IP.",
    "auth_reset_password": "Password-reset completions per IP.",
    "auth_forgot_password_phone": "Phone-based password-reset OTP requests per IP.",
    "auth_reset_password_phone": "Phone-based password-reset completions per IP.",
    "oauth_token": "Partner API token exchanges per IP.",
    "bookings_create": "Seat bookings per IP.",
    "payments_callback": "NairobiPay callback deliveries per IP.",
}

_cache: Dict[str, str] = dict(DEFAULTS)
_refresh_task: Optional[asyncio.Task] = None


def limit_for(scope: str) -> str:
    """Synchronous read used by slowapi's limit callable on every request.

    Never raises and never blocks: an unknown scope falls back to its
    default, and a missing default falls back to a conservative value
    rather than letting a typo disable rate limiting entirely.
    """
    return _cache.get(scope) or DEFAULTS.get(scope) or "60/minute"


def limit_callable(scope: str):
    """Adapter for `@limiter.limit(...)`.

    slowapi accepts either a string or a callable for `limit_value`. The
    callable is invoked per-request; accepting *args/**kwargs keeps this
    working regardless of whether slowapi passes the request through.
    """
    def _resolve(*_args, **_kwargs) -> str:
        return limit_for(scope)
    return _resolve


def current_limits() -> Dict[str, dict]:
    """Full state for the ops console: effective value, default, and
    whether it has been overridden."""
    return {
        scope: {
            "scope": scope,
            "effective": limit_for(scope),
            "default": default,
            "overridden": limit_for(scope) != default,
            "description": DESCRIPTIONS.get(scope, ""),
        }
        for scope, default in DEFAULTS.items()
    }


def parse_limit(value: str) -> tuple[int, str]:
    """Validates a limit string in slowapi's `<count>/<period>` form.

    Returns (count, period) or raises ValueError. Used to reject malformed
    input at the API boundary rather than letting slowapi fail per-request
    later, which would take the endpoint down instead of the edit.
    """
    parts = value.strip().split("/")
    if len(parts) != 2:
        raise ValueError("Expected '<count>/<period>', e.g. '100/minute'")
    count_raw, period = parts[0].strip(), parts[1].strip().lower()
    if period not in ("second", "minute", "hour", "day"):
        raise ValueError("Period must be one of: second, minute, hour, day")
    try:
        count = int(count_raw)
    except ValueError:
        raise ValueError("Count must be a whole number")
    if count < 1:
        raise ValueError("Count must be at least 1")
    if count > 100_000:
        raise ValueError("Count above 100000 effectively disables the limit")
    return count, period


def apply_local(scope: str, value: Optional[str]) -> None:
    """Updates this process's cache immediately. `None` restores the default."""
    if value is None:
        _cache[scope] = DEFAULTS.get(scope, limit_for(scope))
    else:
        _cache[scope] = value


async def publish_to_redis() -> None:
    """Mirrors the current overrides to Redis so other replicas pick them
    up on their next refresh."""
    from app.realtime import get_redis
    try:
        r = await get_redis()
        overrides = {s: v for s, v in _cache.items() if v != DEFAULTS.get(s)}
        await r.set(REDIS_KEY, json.dumps(overrides))
    except Exception as e:
        # A Redis failure must not fail the write — Postgres already holds
        # the truth, and the next successful refresh will reconcile.
        logger.warning("Could not mirror rate limits to Redis: %s", e)


async def load_from_db(db) -> None:
    """Seeds the cache from Postgres. Called once at startup, before any
    request is served, so a restarted process does not silently revert to
    code defaults."""
    from sqlalchemy.future import select
    from app.models import RateLimitOverride
    try:
        result = await db.execute(select(RateLimitOverride))
        for row in result.scalars().all():
            if row.scope in DEFAULTS:
                _cache[row.scope] = row.limit_value
    except Exception as e:
        logger.warning("Could not load rate limit overrides from DB: %s", e)


async def _refresh_loop() -> None:
    from app.realtime import get_redis
    while True:
        try:
            await asyncio.sleep(REFRESH_INTERVAL_SECONDS)
            r = await get_redis()
            raw = await r.get(REDIS_KEY)
            overrides = json.loads(raw) if raw else {}
            for scope, default in DEFAULTS.items():
                _cache[scope] = overrides.get(scope, default)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug("Rate limit refresh skipped: %s", e)


def start_refresh_task() -> None:
    global _refresh_task
    if _refresh_task is None:
        _refresh_task = asyncio.create_task(_refresh_loop())


def stop_refresh_task() -> None:
    global _refresh_task
    if _refresh_task is not None:
        _refresh_task.cancel()
        _refresh_task = None
