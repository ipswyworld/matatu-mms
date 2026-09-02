"""
Origin-destination passenger search (ARCHITECTURE_DECISIONS.md §27.1,
§29.5) — "airplane search": tell the system where you're boarding and
where you're going, get every route/operator that connects them, each
result showing fare/seats side by side like a flight search's carrier
list. Depends on the BRN route/stage digitization (Task 8) and the
fare-stage model (Task 10), both already built — this is the feature that
consumes them.

Real origin+destination search, not the boarding-stage-only picker the
passenger portal had before: matches routes where both stages appear in
the same direction's sequence with "from" strictly before "to" (a
passenger can't board after they'd already have passed their destination).
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import RouteStage, Route, Matatu, Booking, Stage, User, DemandSignal
from app.schemas import BaseModelCamel
from app.auth import get_current_user
from app.routes.fare_stages import get_fare_for_stage_pair

router = APIRouter(prefix="/api/search", tags=["Passenger Search"])


class StageSearchResult(BaseModelCamel):
    id: str
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None


@router.get("/stages", response_model=List[StageSearchResult])
async def search_stages(
    q: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Type-ahead over the real BRN stage list (hundreds of real stops,
    not the old 7-stage hardcoded dropdown) — backs "Guide Me"'s free-text
    destination field. Only geocoded stages: a stage with no real lat/lng
    can't be used as a walking-guidance target."""
    query = q.strip()
    if not query:
        return []
    result = await db.execute(
        select(Stage)
        .where(Stage.name.ilike(f"%{query}%"), Stage.geocoded == True, Stage.lat.is_not(None))
        .order_by(Stage.name)
        .limit(15)
    )
    return [StageSearchResult(id=s.id, name=s.name, lat=s.lat, lng=s.lng) for s in result.scalars().all()]


class ODSearchResult(BaseModelCamel):
    matatu_id: str
    reg_number: str
    route_id: str
    route_name: str
    route_code: str
    from_stage_name: str
    to_stage_name: str
    fare_kes: float
    capacity: int
    seats_available: int
    direction: str


@router.get("/od", response_model=List[ODSearchResult])
async def search_origin_destination(
    from_stage_id: str = Query(...),
    to_stage_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if from_stage_id == to_stage_id:
        return []

    # Demand intelligence (§27.3) — every O-D search is itself a demand
    # signal, aggregated later into an OD matrix / boarding heatmap
    # reproducing the BRN report's one-time passenger survey continuously.
    # Logged regardless of whether any route actually matches (a search
    # with no results is still real demand data — arguably more valuable,
    # since it flags an underserved O-D pair).
    db.add(DemandSignal(
        from_stage_id=from_stage_id, to_stage_id=to_stage_id, source="SEARCH",
        recorded_at=datetime.datetime.now(datetime.timezone.utc),
    ))
    await db.commit()

    from_stages = (
        await db.execute(select(RouteStage).where(RouteStage.stage_id == from_stage_id))
    ).scalars().all()
    to_stages = (
        await db.execute(select(RouteStage).where(RouteStage.stage_id == to_stage_id))
    ).scalars().all()

    # Index "to" candidates by (route_id, direction) for O(1) lookup while
    # walking "from" candidates — matches must share both, with "to"
    # strictly later in the same direction's sequence.
    to_by_route_direction: dict[tuple[str, str], list[RouteStage]] = {}
    for ts in to_stages:
        to_by_route_direction.setdefault((ts.route_id, ts.direction), []).append(ts)

    matching_routes: dict[str, str] = {}  # route_id -> direction, first match wins
    for fs in from_stages:
        key = (fs.route_id, fs.direction)
        for ts in to_by_route_direction.get(key, []):
            if ts.sequence > fs.sequence:
                matching_routes[fs.route_id] = fs.direction
                break

    if not matching_routes:
        return []

    from_stage = (await db.execute(select(Stage).where(Stage.id == from_stage_id))).scalars().first()
    to_stage = (await db.execute(select(Stage).where(Stage.id == to_stage_id))).scalars().first()

    results: List[ODSearchResult] = []
    for route_id, direction in matching_routes.items():
        route = (await db.execute(select(Route).where(Route.id == route_id))).scalars().first()
        if not route:
            continue
        matatus = (
            await db.execute(select(Matatu).where(Matatu.route_id == route_id, Matatu.status == "ACTIVE"))
        ).scalars().all()

        fare = await get_fare_for_stage_pair(db, route_id, from_stage_id, to_stage_id)

        for matatu in matatus:
            taken_result = await db.execute(
                select(Booking).where(Booking.matatu_id == matatu.id, Booking.status == "CONFIRMED")
            )
            taken_seats = sum(len([s for s in b.seat_numbers.split(",") if s]) for b in taken_result.scalars().all())
            seats_available = max(matatu.capacity - taken_seats, 0)
            if seats_available <= 0:
                continue

            results.append(ODSearchResult(
                matatu_id=matatu.id,
                reg_number=matatu.reg_number,
                route_id=route.id,
                route_name=route.name,
                route_code=route.code,
                from_stage_name=from_stage.name if from_stage else from_stage_id,
                to_stage_name=to_stage.name if to_stage else to_stage_id,
                fare_kes=float(fare),
                capacity=matatu.capacity,
                seats_available=seats_available,
                direction=direction,
            ))

    # Cheapest first, then most seats — the two things a passenger
    # comparing "carriers" actually cares about, mirroring flight-search
    # sort conventions per §29.5.
    results.sort(key=lambda r: (r.fare_kes, -r.seats_available))
    return results


# --- Staff record search (Readiness List §18) --------------------------------
#
# Distinct from the passenger origin-destination search above, which answers
# "how do I get from A to B". This answers "find me that vehicle / fine /
# operator", which is what staff do all day and what degrades first as the
# tables grow.

@router.get("/records")
async def search_records(
    q: str = Query(..., min_length=2, max_length=120, description="Search term"),
    limit: int = Query(25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cross-entity search over vehicles, fines, Saccos and users.

    Results are ABAC-scoped to the caller: a Sacco operator sees only their
    own vehicles and fines, and no Sacco directory or user list at all.
    """
    from app.fulltext import search_all
    return await search_all(db, principal=current_user, term=q, limit=limit)
