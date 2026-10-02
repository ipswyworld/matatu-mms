"""Cloudflare Turnstile verification — bot protection on login, register,
and password-reset (MULTI_STAKEHOLDER_REVIEW.md Phase 2, Security
Checklist #12).

Deliberately fails open when unconfigured, not closed: TURNSTILE_SECRET_KEY
is unset on every local dev machine and on any deploy that hasn't created
a Turnstile site yet, and there is no reason those should suddenly be
unable to log in. Once a real secret key is set, verification is real and
failures are rejected.
"""
import logging

import httpx

from app.config import TURNSTILE_SECRET_KEY

logger = logging.getLogger("app.turnstile")

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile(token: str | None, remote_ip: str | None = None) -> bool:
    if not TURNSTILE_SECRET_KEY:
        return True

    if not token:
        return False

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            data = {"secret": TURNSTILE_SECRET_KEY, "response": token}
            if remote_ip:
                data["remoteip"] = remote_ip
            res = await client.post(VERIFY_URL, data=data)
            result = res.json()
            return bool(result.get("success"))
    except Exception:
        # A Cloudflare outage should not be a second way to lock everyone
        # out on top of whatever's already down — log it and let the
        # request through, the same fail-open stance as Sentry (RUNBOOKS.md).
        logger.warning("Turnstile verification request failed; allowing through.", exc_info=True)
        return True
