"""One-time backfill: geocode every Stage row that has no lat/lng yet, using
TomTom's Fuzzy Search API (same provider already used for the live map, so
no new vendor dependency). Needed to draw all 125 routes on the network map
(components/dashboard/RouteNetworkMap.tsx) rather than only the ~91 routes
whose stages happened to already be geocoded from the original BRN PDF
digitization pass.

The actual TomTom call + Nairobi bounding-box check now live in
app/terminal_matching.py (geocode_place), shared with the live
operator-terminal-submission path — this script just drives it in bulk.

Run from backend/: python scripts/geocode_stages.py
"""
import asyncio
import os
import sys

import httpx
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import AsyncSessionLocal  # noqa: E402
from app.models import Stage  # noqa: E402
from app.terminal_matching import geocode_place  # noqa: E402
from app.config import TOMTOM_API_KEY  # noqa: E402


async def main():
    if not TOMTOM_API_KEY:
        print("Set TOMTOM_API_KEY in the environment first.")
        return

    async with AsyncSessionLocal() as db:
        stages = (await db.execute(select(Stage).where(Stage.lat.is_(None)))).scalars().all()
        print(f"{len(stages)} ungeocoded stages to process.")

        succeeded, failed = 0, []
        async with httpx.AsyncClient() as client:
            for i, stage in enumerate(stages, 1):
                coords = await geocode_place(client, stage.name)
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
