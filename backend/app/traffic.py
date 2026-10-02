"""
The "other half" of the crowdsourced Live Updates feed (app/routes/
public_updates.py) — real, official incident data from TomTom's Traffic
Incident Details API v5, covering greater Nairobi. Crowdsourced reports
catch what a passenger notices right now on their own road; this catches
what TomTom's own probe-vehicle/sensor network already knows about across
the whole city, including roads with zero app users on them at that moment.
Neither replaces the other — list_condition_reports() in public_updates.py
merges both into one feed, tagged by source.

Deliberately not persisted to Postgres: a live-traffic snapshot is only
meaningful for a couple of minutes, so it's cached in Redis with a short
TTL rather than given its own table and a cleanup job.
"""
import datetime
import json
import logging
import uuid
from typing import List, TypedDict

import httpx

from app.config import TOMTOM_API_KEY
from app.realtime import get_redis
from app.resilience import CircuitBreaker, CircuitBreakerOpenException

logger = logging.getLogger("app.traffic")

# minLon, minLat, maxLon, maxLat — greater Nairobi (covers the county plus a
# small margin so a jam just outside the boundary, e.g. on Mombasa Road
# heading into Athi River, still shows up for a route that uses it).
NAIROBI_BBOX = (36.60, -1.45, 37.05, -1.10)

TOMTOM_INCIDENTS_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails"
CACHE_KEY = "traffic:tomtom:nairobi"
CACHE_TTL_SECONDS = 120  # matches roughly how often TomTom's own feed refreshes

# TomTom iconCategory -> this project's ConditionReport categories
# (RAIN, TRAFFIC_JAM, ACCIDENT, ROAD_BLOCKED, POLICE_CHECK, OTHER). TomTom
# has no "police check" concept, so that category only ever comes from
# crowdsourced reports — expected, not a mapping gap.
ICON_CATEGORY_MAP = {
    1: "ACCIDENT",
    4: "RAIN",
    6: "TRAFFIC_JAM",
    7: "ROAD_BLOCKED",
    8: "ROAD_BLOCKED",
    9: "ROAD_BLOCKED",
    11: "ROAD_BLOCKED",  # flooding
}

_breaker = CircuitBreaker(failure_threshold=3, recovery_time=60.0)


class TomTomIncident(TypedDict):
    id: str
    category: str
    location_label: str
    message: str
    created_at: datetime.datetime
    source: str


def _describe_location(props: dict) -> str:
    from_road = (props.get("from") or "").strip()
    to_road = (props.get("to") or "").strip()
    if from_road and to_road:
        return f"{from_road} to {to_road}"
    road_numbers = props.get("roadNumbers") or []
    if road_numbers:
        return ", ".join(road_numbers)
    return "Nairobi road network"


def _parse_incidents(payload: dict) -> List[TomTomIncident]:
    now = datetime.datetime.now(datetime.timezone.utc)
    parsed: List[TomTomIncident] = []
    for feature in payload.get("incidents", []):
        props = feature.get("properties", {})
        icon_category = props.get("iconCategory")
        category = ICON_CATEGORY_MAP.get(icon_category, "OTHER")
        events = props.get("events") or []
        description = events[0].get("description") if events else None
        parsed.append(
            TomTomIncident(
                id=f"tomtom-{uuid.uuid5(uuid.NAMESPACE_URL, str(feature.get('geometry', {}).get('coordinates', props)))}",
                category=category,
                location_label=_describe_location(props),
                message=description or "Reported by TomTom traffic data.",
                created_at=now,
                source="TOMTOM",
            )
        )
    return parsed


async def _fetch_from_tomtom() -> List[TomTomIncident]:
    min_lon, min_lat, max_lon, max_lat = NAIROBI_BBOX
    params = {
        "key": TOMTOM_API_KEY,
        "bbox": f"{min_lon},{min_lat},{max_lon},{max_lat}",
        "fields": "{incidents{type,geometry{type,coordinates},properties{iconCategory,events{description,code,iconCategory},from,to,roadNumbers}}}",
        "language": "en-GB",
        "timeValidityFilter": "present",
    }
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.get(TOMTOM_INCIDENTS_URL, params=params)
        response.raise_for_status()
        return _parse_incidents(response.json())


async def get_tomtom_incidents() -> List[TomTomIncident]:
    """Cached, resilient read of live Nairobi traffic incidents. Returns an
    empty list — never raises — whenever the key is unset, TomTom is down,
    or the circuit breaker is open: this is explicitly the "extra" half of
    the feed, and a passenger's own crowdsourced reports must never go
    missing just because an external dependency is having a bad day."""
    if not TOMTOM_API_KEY:
        return []

    redis = await get_redis()
    cached = await redis.get(CACHE_KEY)
    if cached:
        try:
            raw_list = json.loads(cached)
            return [
                TomTomIncident(
                    id=i["id"], category=i["category"], location_label=i["location_label"],
                    message=i["message"], created_at=datetime.datetime.fromisoformat(i["created_at"]),
                    source="TOMTOM",
                )
                for i in raw_list
            ]
        except (ValueError, KeyError):
            pass  # fall through and refetch rather than fail on a corrupt cache entry

    try:
        incidents = await _breaker.call(_fetch_from_tomtom)
    except (CircuitBreakerOpenException, httpx.HTTPError) as e:
        logger.warning("TomTom traffic incident fetch unavailable: %s", e)
        return []

    await redis.set(
        CACHE_KEY,
        json.dumps([{**i, "created_at": i["created_at"].isoformat()} for i in incidents]),
        ex=CACHE_TTL_SECONDS,
    )
    return incidents
