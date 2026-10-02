"""Shared text -> real-world-location resolution, used by two callers:

1. scripts/geocode_stages.py — the one-time offline Stage lat/lng backfill.
2. match_terminal_label() below — the live path an operator's self-declared
   terminal (OperatorTerminal.label) goes through when submitted.

Both share the same TomTom Fuzzy Search call and the same Nairobi
bounding-box sanity check (in_nairobi) so a bad geocode is rejected rather
than silently plotted in the wrong place — this module is just that shared
logic pulled out from the script so it isn't duplicated.

Text-to-Stage matching itself (step 1 below) mirrors the only existing
precedent in this codebase, app/routes/fare_stages.py's from_label/to_label
resolution: a plain lowercase+strip exact match against Stage.name. There is
no fuzzy-matching library anywhere in this backend, and this module doesn't
introduce one — an unmatched label falls through to geocoding, and a failed
geocode is left UNRESOLVED for a staff member to fix by hand, never guessed.
"""
import re
import secrets
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import TOMTOM_API_KEY
from app.models import Stage

NAIROBI_LAT, NAIROBI_LNG = -1.2864, 36.8228
SEARCH_URL = "https://api.tomtom.com/search/2/search/{query}.json"

# Nairobi's bounding box, loosely — rejects a geocode hit that lands nowhere
# near the city (a wrong disambiguation for an ambiguous name) rather than
# silently plotting a terminal in the wrong county/country.
NAIROBI_BBOX = {"minLat": -1.50, "maxLat": -1.10, "minLng": 36.60, "maxLng": 37.05}


def in_nairobi(lat: float, lng: float) -> bool:
    return NAIROBI_BBOX["minLat"] <= lat <= NAIROBI_BBOX["maxLat"] and NAIROBI_BBOX["minLng"] <= lng <= NAIROBI_BBOX["maxLng"]


def clean_query(name: str) -> str:
    # Real-world stage/terminal names carry artifacts ("/ Hakati",
    # "-Kabiria") that confuse a places search more than they help it —
    # strip to the first clear segment and always anchor to Nairobi, Kenya.
    name = re.split(r"[/]", name)[0].strip()
    return f"{name}, Nairobi, Kenya"


async def geocode_place(client: httpx.AsyncClient, name: str) -> Optional[tuple[float, float]]:
    """TomTom Fuzzy Search for a place name, bbox-checked. Returns None on
    any failure or an out-of-Nairobi result — never a guess."""
    if not TOMTOM_API_KEY:
        return None
    query = clean_query(name)
    try:
        resp = await client.get(
            SEARCH_URL.format(query=quote(query)),
            params={
                "key": TOMTOM_API_KEY,
                "lat": NAIROBI_LAT,
                "lon": NAIROBI_LNG,
                "radius": 60000,
                "countrySet": "KE",
                "limit": 1,
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        results = resp.json().get("results") or []
        if not results:
            return None
        pos = results[0]["position"]
        lat, lng = pos["lat"], pos["lon"]
        if not in_nairobi(lat, lng):
            return None
        return lat, lng
    except Exception:  # noqa: BLE001 — best-effort, same as the offline script
        return None


@dataclass
class TerminalMatchResult:
    match_status: str  # MATCHED_EXISTING_STAGE, GEOCODED_NEW, UNRESOLVED
    stage_id: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    geocoded: bool


async def match_terminal_label(db: AsyncSession, label: str) -> TerminalMatchResult:
    """Resolve an operator's raw terminal label against the map. Never
    fabricates a coordinate: only MATCHED_EXISTING_STAGE (exact name match)
    or GEOCODED_NEW (a confident, bbox-checked TomTom hit — the same
    confidence bar the offline backfill script already trusts unattended)
    set lat/lng/stage_id. Anything else comes back UNRESOLVED for a staff
    member to confirm by hand."""
    normalized = label.strip().lower()
    if normalized:
        existing = (
            await db.execute(select(Stage).where(Stage.name.ilike(label.strip())))
        ).scalars().first()
        if existing:
            return TerminalMatchResult(
                match_status="MATCHED_EXISTING_STAGE",
                stage_id=existing.id,
                lat=existing.lat,
                lng=existing.lng,
                geocoded=existing.geocoded,
            )

    async with httpx.AsyncClient() as client:
        coords = await geocode_place(client, label)
    if coords:
        lat, lng = coords
        new_stage = Stage(
            id=f"stage-{secrets.token_hex(4)}",
            name=label.strip(),
            stage_type="TERMINUS",
            lat=lat,
            lng=lng,
            geocoded=True,
        )
        db.add(new_stage)
        await db.flush()
        return TerminalMatchResult(
            match_status="GEOCODED_NEW", stage_id=new_stage.id, lat=lat, lng=lng, geocoded=True,
        )

    return TerminalMatchResult(match_status="UNRESOLVED", stage_id=None, lat=None, lng=None, geocoded=False)
