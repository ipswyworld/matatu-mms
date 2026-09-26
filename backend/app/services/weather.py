"""
Weather-aware terminal choice (Phase 8, #14 of the journey-planning plan) —
a single cached "is it raining in Nairobi right now" check, not a per-request
lookup. Nairobi is compact enough (the whole BRN network fits in roughly a
20km radius) that one city-wide reading is an honest approximation; there is
no per-stage microclimate modelling here.

Uses Open-Meteo (https://open-meteo.com) — no API key, no account, a free
public forecast API — rather than a paid provider, since this deployment has
no weather API credentials configured (same "no real provider wired in yet"
situation as sms.py's Africa's Talking integration). If that ever changes,
only this module needs to know.

Best-effort like every other external call in this codebase (sms.py,
telemetry persistence): a failure here must never block a passenger's
search. Failing to "not raining" (no bias) is the safe default — a false
negative just means no bias is applied, not a wrong/dangerous routing
decision.
"""
import datetime
import logging

import httpx

from app.realtime import get_redis

logger = logging.getLogger("app.services.weather")

# Roughly central Nairobi — good enough for a single city-wide reading.
NAIROBI_LAT = -1.286389
NAIROBI_LNG = 36.817223

CACHE_KEY = "weather:nairobi:is_raining"
# Refreshed every 10 minutes — weather doesn't change fast enough to justify
# a real network call on every search, but this is still far more current
# than checking once an hour.
CACHE_TTL_SECONDS = 600

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


async def is_raining_nairobi() -> bool:
    """Cached, best-effort check. Returns False (no bias) on any failure —
    a stale/unreachable weather API should never be the reason a passenger's
    search breaks."""
    try:
        r = await get_redis()
        cached = await r.get(CACHE_KEY)
        if cached is not None:
            return cached == b"1" or cached == "1"
    except Exception:
        logger.exception("Weather cache read failed; falling through to a live check")

    raining = await _fetch_is_raining()

    try:
        r = await get_redis()
        await r.set(CACHE_KEY, "1" if raining else "0", ex=CACHE_TTL_SECONDS)
    except Exception:
        logger.exception("Weather cache write failed (non-fatal)")

    return raining


async def _fetch_is_raining() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(OPEN_METEO_URL, params={
                "latitude": NAIROBI_LAT,
                "longitude": NAIROBI_LNG,
                "current": "precipitation",
            })
            resp.raise_for_status()
            data = resp.json()
            precipitation = data.get("current", {}).get("precipitation")
            return bool(precipitation) and precipitation > 0
    except Exception:
        logger.warning("Weather lookup failed; defaulting to no rain bias", exc_info=True)
        return False
