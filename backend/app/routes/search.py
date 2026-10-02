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
import math
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
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


class NearestStageResult(BaseModelCamel):
    id: str
    name: str
    lat: float
    lng: float
    distance_meters: float
    wheelchair_accessible: bool = False


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# How much closer a plain STAGE has to be than the nearest TERMINUS before
# the terminus is skipped in the rain. A terminus is more likely to have
# real shelter than a bare roadside stage — this is a bias toward that,
# not a claim that any specific terminus actually has a roof. Chosen loose
# enough that "same distance, terminus is nicer" wins, but a genuinely much
# closer stage still wins over a much farther terminus.
RAIN_TERMINUS_PREFERENCE_RATIO = 1.5


def pick_nearest_stage(stages: list, lat: float, lng: float, is_raining: bool):
    """Pure ranking function (Phase 8, #14) — no DB/network access, so it's
    directly unit-testable with fabricated stage-like objects. `stages` must
    be non-empty; the caller (nearest_stage below) owns the 404 case.

    Dry weather: strictly nearest, unchanged from Phase 1/7.
    Raining: prefer the nearest TERMINUS over the nearest plain STAGE,
    provided it isn't more than RAIN_TERMINUS_PREFERENCE_RATIO times
    farther away — see the constant's own comment for why a terminus.
    """
    nearest = min(stages, key=lambda s: haversine_m(lat, lng, s.lat, s.lng))
    if not is_raining:
        return nearest

    termini = [s for s in stages if s.stage_type == "TERMINUS"]
    if not termini:
        return nearest

    nearest_terminus = min(termini, key=lambda s: haversine_m(lat, lng, s.lat, s.lng))
    if nearest_terminus.id == nearest.id:
        return nearest

    nearest_dist = haversine_m(lat, lng, nearest.lat, nearest.lng)
    terminus_dist = haversine_m(lat, lng, nearest_terminus.lat, nearest_terminus.lng)
    if nearest_dist == 0 or terminus_dist <= nearest_dist * RAIN_TERMINUS_PREFERENCE_RATIO:
        return nearest_terminus
    return nearest


@router.get("/nearest-stage", response_model=NearestStageResult)
async def nearest_stage(
    lat: float = Query(...),
    lng: float = Query(...),
    accessibility_required: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The passenger-facing counterpart to
    operator_terminals.py's `/nearest` — that one is gated
    `view_operator_terminals` (staff-only: ADMIN/SUPERADMIN/
    DIRECTOR_MOBILITY/CHIEF_OFFICER), so a PASSENGER calling it has always
    gotten a 403, silently swallowed by the frontend's try/except into a
    null result. This is the same plain-Python-haversine-over-geocoded-
    stages approach, open to any authenticated user, so "type an unmapped
    place, fall back to the nearest real stage" actually works for
    passengers instead of only ever failing quietly.

    accessibility_required (Phase 7, #15) filters to
    Stage.wheelchair_accessible stages when set — a hard filter, not a
    ranking bias, since a passenger who needs this can't use a "closer but
    inaccessible" result at all. Falls back to the unfiltered set only if
    filtering would otherwise return nothing, so the endpoint never 404s
    just because no accessible stage happens to be nearby yet.

    When it's currently raining in Nairobi (Phase 8, #14 — see
    app/services/weather.py), the ranking itself shifts toward a nearby
    terminus over a bare stage; see pick_nearest_stage's own docstring.
    """
    base_query = select(Stage).where(Stage.geocoded == True, Stage.lat.is_not(None))  # noqa: E712
    stages = []
    if accessibility_required:
        result = await db.execute(base_query.where(Stage.wheelchair_accessible == True))  # noqa: E712
        stages = result.scalars().all()
    if not stages:
        result = await db.execute(base_query)
        stages = result.scalars().all()
    if not stages:
        raise HTTPException(status_code=404, detail="No geocoded stages available")

    from app.services.weather import is_raining_nairobi
    raining = await is_raining_nairobi()
    nearest = pick_nearest_stage(stages, lat, lng, raining)
    return NearestStageResult(
        id=nearest.id,
        name=nearest.name,
        lat=nearest.lat,
        lng=nearest.lng,
        distance_meters=haversine_m(lat, lng, nearest.lat, nearest.lng),
        wheelchair_accessible=nearest.wheelchair_accessible,
    )


@router.get("/reachable-destinations", response_model=List[StageSearchResult])
async def reachable_destinations(
    from_stage_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """When a typed destination matches nothing (e.g. a colloquial place
    name not in the BRN stage list), the honest fallback isn't a dead
    end — it's "here's everywhere you can actually get to from where
    you're boarding." Reuses the exact same "stages reachable after the
    origin on the same route/direction" computation as od-multi-leg's
    after_origin set, just returned directly as suggestions instead of fed
    into a transfer search.
    """
    from_stages = (
        await db.execute(select(RouteStage).where(RouteStage.stage_id == from_stage_id))
    ).scalars().all()
    if not from_stages:
        return []

    route_ids = {fs.route_id for fs in from_stages}
    all_route_stages = (
        await db.execute(select(RouteStage).where(RouteStage.route_id.in_(route_ids)))
    ).scalars().all()
    by_route_direction: dict[tuple[str, str], list[RouteStage]] = {}
    for rs in all_route_stages:
        by_route_direction.setdefault((rs.route_id, rs.direction), []).append(rs)

    reachable_ids: set[str] = set()
    for fs in from_stages:
        for rs in by_route_direction.get((fs.route_id, fs.direction), []):
            if rs.sequence > fs.sequence:
                reachable_ids.add(rs.stage_id)
    reachable_ids.discard(from_stage_id)
    if not reachable_ids:
        return []

    stages = (
        await db.execute(
            select(Stage).where(Stage.id.in_(reachable_ids), Stage.geocoded == True)  # noqa: E712
        )
    ).scalars().all()
    stages.sort(key=lambda s: s.name)
    return [StageSearchResult(id=s.id, name=s.name, lat=s.lat, lng=s.lng) for s in stages[:50]]


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


class MultiLegLegResult(BaseModelCamel):
    matatu_id: str
    reg_number: str
    route_id: str
    route_name: str
    route_code: str
    from_stage_id: str
    from_stage_name: str
    to_stage_id: str
    to_stage_name: str
    fare_kes: float
    capacity: int
    seats_available: int
    direction: str


class MultiLegSearchResult(BaseModelCamel):
    leg1: MultiLegLegResult
    leg2: MultiLegLegResult
    transfer_stage_id: str
    transfer_stage_name: str
    transfer_stage_lat: float
    transfer_stage_lng: float
    total_fare_kes: float


async def _best_leg(db: AsyncSession, route: Route, from_stage: Stage, to_stage: Stage, direction: str) -> Optional[MultiLegLegResult]:
    """The single best (most seats available) ACTIVE matatu on this route for
    this stage pair, or None if nothing is running with room. One-transfer
    itineraries are grouped per (route, transfer) triple, not fanned out
    over every matatu on each leg — mirrors "each triple is a 2-leg
    itinerary" from the plan, not a full cross-product of vehicles."""
    matatus = (
        await db.execute(select(Matatu).where(Matatu.route_id == route.id, Matatu.status == "ACTIVE"))
    ).scalars().all()
    if not matatus:
        return None

    fare = await get_fare_for_stage_pair(db, route.id, from_stage.id, to_stage.id)
    best: Optional[MultiLegLegResult] = None
    for matatu in matatus:
        taken_result = await db.execute(
            select(Booking).where(Booking.matatu_id == matatu.id, Booking.status == "CONFIRMED")
        )
        taken_seats = sum(len([s for s in b.seat_numbers.split(",") if s]) for b in taken_result.scalars().all())
        seats_available = max(matatu.capacity - taken_seats, 0)
        if seats_available <= 0:
            continue
        if best is None or seats_available > best.seats_available:
            best = MultiLegLegResult(
                matatu_id=matatu.id, reg_number=matatu.reg_number,
                route_id=route.id, route_name=route.name, route_code=route.code,
                from_stage_id=from_stage.id, from_stage_name=from_stage.name,
                to_stage_id=to_stage.id, to_stage_name=to_stage.name,
                fare_kes=float(fare), capacity=matatu.capacity,
                seats_available=seats_available, direction=direction,
            )
    return best


@router.get("/od-multi-leg", response_model=List[MultiLegSearchResult])
async def search_multi_leg(
    from_stage_id: str = Query(...),
    to_stage_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """One-transfer journeys (Phase 9, #6) — the frontend calls this only
    after the plain direct search (/od above) comes back empty, since a
    transfer is strictly a fallback to a direct ride, never preferred over
    one. v1 scope is a single transfer, not full multi-hop pathfinding:
    RouteStage's real route graph (route_id, stage_id, sequence, direction)
    makes a one-transfer search cheap and exact; anything beyond one
    transfer is exponential blowup this hub-and-spoke city network doesn't
    need.

    Algorithm: for every route A serving the origin and route B serving the
    destination (A != B), find stages reachable after the origin on A's
    same direction, and stages that reach the destination on B's same
    direction; any stage in both sets is a valid transfer point. Two extra
    queries (all RouteStage rows for A's and B's route sets) instead of one
    query per (A, B) pair keeps this from becoming N*M round trips.
    """
    if from_stage_id == to_stage_id:
        return []

    from_stages = (
        await db.execute(select(RouteStage).where(RouteStage.stage_id == from_stage_id))
    ).scalars().all()
    to_stages = (
        await db.execute(select(RouteStage).where(RouteStage.stage_id == to_stage_id))
    ).scalars().all()
    if not from_stages or not to_stages:
        return []

    from_route_ids = {fs.route_id for fs in from_stages}
    to_route_ids = {ts.route_id for ts in to_stages}

    all_from_route_stages = (
        await db.execute(select(RouteStage).where(RouteStage.route_id.in_(from_route_ids)))
    ).scalars().all()
    all_to_route_stages = (
        await db.execute(select(RouteStage).where(RouteStage.route_id.in_(to_route_ids)))
    ).scalars().all()

    by_route_direction_a: dict[tuple[str, str], list[RouteStage]] = {}
    for rs in all_from_route_stages:
        by_route_direction_a.setdefault((rs.route_id, rs.direction), []).append(rs)
    by_route_direction_b: dict[tuple[str, str], list[RouteStage]] = {}
    for rs in all_to_route_stages:
        by_route_direction_b.setdefault((rs.route_id, rs.direction), []).append(rs)

    # (route_a_id, direction_a, route_b_id, direction_b, transfer_stage_id) tuples.
    candidate_transfers: list[tuple[str, str, str, str, str]] = []
    for fs in from_stages:
        after_origin = {
            rs.stage_id for rs in by_route_direction_a.get((fs.route_id, fs.direction), [])
            if rs.sequence > fs.sequence
        }
        if not after_origin:
            continue
        for ts in to_stages:
            if ts.route_id == fs.route_id:
                continue  # same route -> would already be a direct match
            before_dest = {
                rs.stage_id for rs in by_route_direction_b.get((ts.route_id, ts.direction), [])
                if rs.sequence < ts.sequence
            }
            for transfer_stage_id in after_origin & before_dest:
                candidate_transfers.append((fs.route_id, fs.direction, ts.route_id, ts.direction, transfer_stage_id))

    if not candidate_transfers:
        return []

    from_stage = (await db.execute(select(Stage).where(Stage.id == from_stage_id))).scalars().first()
    to_stage = (await db.execute(select(Stage).where(Stage.id == to_stage_id))).scalars().first()
    if not from_stage or not to_stage:
        return []

    results: List[MultiLegSearchResult] = []
    seen_triples: set[tuple[str, str, str]] = set()
    for route_a_id, direction_a, route_b_id, direction_b, transfer_stage_id in candidate_transfers:
        triple = (route_a_id, route_b_id, transfer_stage_id)
        if triple in seen_triples:
            continue
        seen_triples.add(triple)

        route_a = (await db.execute(select(Route).where(Route.id == route_a_id))).scalars().first()
        route_b = (await db.execute(select(Route).where(Route.id == route_b_id))).scalars().first()
        transfer_stage = (await db.execute(select(Stage).where(Stage.id == transfer_stage_id))).scalars().first()
        if not route_a or not route_b or not transfer_stage:
            continue

        leg1 = await _best_leg(db, route_a, from_stage, transfer_stage, direction_a)
        leg2 = await _best_leg(db, route_b, transfer_stage, to_stage, direction_b)
        if not leg1 or not leg2:
            continue

        results.append(MultiLegSearchResult(
            leg1=leg1, leg2=leg2,
            transfer_stage_id=transfer_stage.id, transfer_stage_name=transfer_stage.name,
            transfer_stage_lat=transfer_stage.lat, transfer_stage_lng=transfer_stage.lng,
            total_fare_kes=leg1.fare_kes + leg2.fare_kes,
        ))

    # Same convention as the direct search: cheapest combined fare first,
    # then the bottleneck leg's seat count (the leg with fewer seats is
    # what actually constrains the group), most first.
    results.sort(key=lambda r: (r.total_fare_kes, -min(r.leg1.seats_available, r.leg2.seats_available)))
    return results[:10]


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
