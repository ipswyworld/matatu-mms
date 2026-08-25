"""One-time backfill: geocode every Stage row that has no lat/lng yet, using
TomTom's Fuzzy Search API (same provider already used for the live map, so
no new vendor dependency). Needed to draw all 125 routes on the network map
(components/dashboard/RouteNetworkMap.tsx) rather than only the ~91 routes
whose stages happened to already be geocoded from the original BRN PDF
digitization pass.

Run from backend/: python scripts/geocode_stages.py
"""
import asyncio
import os
import re
import sys
from urllib.parse import quote

import httpx
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import AsyncSessionLocal  # noqa: E402
from app.models import Stage  # noqa: E402

TOMTOM_API_KEY = os.environ.get("TOMTOM_API_KEY") or os.environ.get("NEXT_PUBLIC_TOMTOM_API_KEY")
NAIROBI_LAT, NAIROBI_LNG = -1.2864, 36.8228
SEARCH_URL = "https://api.tomtom.com/search/2/search/{query}.json"

# Nairobi's bounding box, loosely — rejects a geocode hit that lands
# nowhere near the city (a wrong disambiguation for an ambiguous name)
# rather than silently plotting a stage in the wrong county/country.
NAIROBI_BBOX = {"minLat": -1.50, "maxLat": -1.10, "minLng": 36.60, "maxLng": 37.05}


def in_nairobi(lat: float, lng: float) -> bool:
    return NAIROBI_BBOX["minLat"] <= lat <= NAIROBI_BBOX["maxLat"] and NAIROBI_BBOX["minLng"] <= lng <= NAIROBI_BBOX["maxLng"]


def clean_query(name: str) -> str:
    # Stage names carry BRN-report artifacts ("/ Hakati", "-Kabiria") that
    # confuse a places search more than they help it — strip to the first
    # clear segment and always anchor the search to Nairobi, Kenya.
    name = re.split(r"[/]", name)[0].strip()
    return f"{name}, Nairobi, Kenya"


async def geocode_one(client: httpx.AsyncClient, name: str) -> tuple[float, float] | None:
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
    except Exception as exc:  # noqa: BLE001 — log and move on, this is a best-effort backfill
        print(f"  ERROR geocoding {name!r}: {exc}")
        return None


async def main():
    if not TOMTOM_API_KEY:
        print("Set TOMTOM_API_KEY (or NEXT_PUBLIC_TOMTOM_API_KEY) in the environment first.")
        return

    async with AsyncSessionLocal() as db:
        stages = (await db.execute(select(Stage).where(Stage.lat.is_(None)))).scalars().all()
        print(f"{len(stages)} ungeocoded stages to process.")

        succeeded, failed = 0, []
        async with httpx.AsyncClient() as client:
            for i, stage in enumerate(stages, 1):
                coords = await geocode_one(client, stage.name)
                if coords:
                    stage.lat, stage.lng = coords
                    stage.geocoded = True
                    succeeded += 1
                else:
                    failed.append(stage.name)
                if i % 20 == 0:
                    await db.commit()
                    print(f"  ...{i}/{len(stages)} processed, {succeeded} geocoded so far")
                await asyncio.sleep(0.15)  # gentle on TomTom's rate limit

        await db.commit()
        print(f"\nDone. Geocoded {succeeded}/{len(stages)}.")
        if failed:
            print(f"{len(failed)} stages still ungeocoded (no confident match):")
            for name in failed:
                print(f"  - {name}")


if __name__ == "__main__":
    asyncio.run(main())
