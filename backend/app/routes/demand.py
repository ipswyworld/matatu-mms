"""
Demand intelligence aggregation (ARCHITECTURE_DECISIONS.md §27.3, Task 23)
— reads the DemandSignal log (app/routes/search.py logs every O-D search;
bookings.py logs every real booking) and returns the two views the county
planning side actually wants: an OD matrix (which stage-pairs get
searched/booked together) and a boarding heatmap (which stages see the
most activity, regardless of destination). Both are server-side
aggregations over a bounded log table, never raw signal rows shipped to
the client — same "aggregate on the server" principle as §23.3.
"""
import datetime
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import DemandSignal, Route, ScheduledBooking, Stage, Trip, User
from app.schemas import BaseModelCamel
from app.auth import requires_permission

router = APIRouter(prefix="/api/demand", tags=["Demand Intelligence"])


class ODMatrixCell(BaseModelCamel):
    from_stage_id: str
    from_stage_name: str
    to_stage_id: str
    to_stage_name: str
    search_count: int
    booking_count: int


class BoardingHeatmapPoint(BaseModelCamel):
    stage_id: str
    stage_name: str
    lat: float | None = None
    lng: float | None = None
    activity_count: int


class RouteRidership(BaseModelCamel):
    route_id: str
    route_name: str
    route_code: str
    total_passengers: int
    trips_completed: int
    # Of trips_completed, how many actually had a headcount logged — the
    # honesty signal for this whole feature: crew headcount logging is
    # optional, so total_passengers is a real number but very likely an
    # undercount of true ridership on routes with low coverage. A route
    # showing 40 passengers from 2/50 trips logged is not "quiet," it's
    # "barely measured" — this field is what lets a viewer tell the
    # difference instead of reading total_passengers at face value.
    trips_with_count: int


@router.get("/od-matrix", response_model=List[ODMatrixCell])
async def get_od_matrix(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(requires_permission("view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    # Count searches and bookings separately per O-D pair with two
    # conditional (FILTER) counts in one grouped query.
    query = (
        select(
            DemandSignal.from_stage_id,
            DemandSignal.to_stage_id,
            func.count(DemandSignal.id).filter(DemandSignal.source == "SEARCH").label("search_count"),
            func.count(DemandSignal.id).filter(DemandSignal.source == "BOOKING").label("booking_count"),
        )
        .where(DemandSignal.recorded_at >= since, DemandSignal.to_stage_id.is_not(None))
        .group_by(DemandSignal.from_stage_id, DemandSignal.to_stage_id)
        .order_by(func.count(DemandSignal.id).desc())
    )
    result = await db.execute(query)
    rows = result.all()

    stage_ids = {r.from_stage_id for r in rows} | {r.to_stage_id for r in rows}
    stages_result = await db.execute(select(Stage).where(Stage.id.in_(stage_ids))) if stage_ids else None
    stage_names = {s.id: s.name for s in stages_result.scalars().all()} if stages_result else {}

    return [
        ODMatrixCell(
            from_stage_id=r.from_stage_id,
            from_stage_name=stage_names.get(r.from_stage_id, r.from_stage_id),
            to_stage_id=r.to_stage_id,
            to_stage_name=stage_names.get(r.to_stage_id, r.to_stage_id),
            search_count=r.search_count,
            booking_count=r.booking_count,
        )
        for r in rows
    ]


@router.get("/boarding-heatmap", response_model=List[BoardingHeatmapPoint])
async def get_boarding_heatmap(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(requires_permission("view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    query = (
        select(DemandSignal.from_stage_id, func.count(DemandSignal.id).label("activity_count"))
        .where(DemandSignal.recorded_at >= since)
        .group_by(DemandSignal.from_stage_id)
        .order_by(func.count(DemandSignal.id).desc())
    )
    result = await db.execute(query)
    rows = result.all()

    stage_ids = [r.from_stage_id for r in rows]
    stages_result = await db.execute(select(Stage).where(Stage.id.in_(stage_ids))) if stage_ids else None
    stages_by_id = {s.id: s for s in stages_result.scalars().all()} if stages_result else {}

    points: List[BoardingHeatmapPoint] = []
    for r in rows:
        stage = stages_by_id.get(r.from_stage_id)
        points.append(BoardingHeatmapPoint(
            stage_id=r.from_stage_id,
            stage_name=stage.name if stage else r.from_stage_id,
            lat=stage.lat if stage else None,
            lng=stage.lng if stage else None,
            activity_count=r.activity_count,
        ))
    return points


@router.get("/ridership-by-route", response_model=List[RouteRidership])
async def get_ridership_by_route(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(requires_permission("view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Real, crew-logged ridership per route (Trip.passenger_count) — the
    counterpart to od-matrix/boarding-heatmap above, which only ever see
    app-based search/booking activity. count(Trip.passenger_count) skips
    NULLs (trips where crew didn't log a headcount) the same way
    analytics.py's timeseries endpoint does for the "ridership" metric —
    trips_completed and trips_with_count are reported separately rather
    than collapsed into one number specifically so this can't be misread
    as complete ridership data when it's actually partial-coverage data.
    """
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    query = (
        select(
            Trip.route_id,
            func.coalesce(func.sum(Trip.passenger_count), 0).label("total_passengers"),
            func.count(Trip.id).label("trips_completed"),
            func.count(Trip.passenger_count).label("trips_with_count"),
        )
        .where(Trip.status == "COMPLETED", Trip.ended_at >= since)
        .group_by(Trip.route_id)
        .order_by(func.coalesce(func.sum(Trip.passenger_count), 0).desc())
    )
    result = await db.execute(query)
    rows = result.all()

    route_ids = [r.route_id for r in rows]
    routes_result = await db.execute(select(Route).where(Route.id.in_(route_ids))) if route_ids else None
    routes_by_id = {r.id: r for r in routes_result.scalars().all()} if routes_result else {}

    return [
        RouteRidership(
            route_id=r.route_id,
            route_name=routes_by_id[r.route_id].name if r.route_id in routes_by_id else r.route_id,
            route_code=routes_by_id[r.route_id].code if r.route_id in routes_by_id else "",
            total_passengers=r.total_passengers,
            trips_completed=r.trips_completed,
            trips_with_count=r.trips_with_count,
        )
        for r in rows
    ]


class ScheduledBookingsByRoute(BaseModelCamel):
    route_id: str
    route_name: str
    route_code: str
    scheduled_count: int
    most_common_hour: int | None = None
    top_origin_stage_id: str | None = None
    top_origin_stage_name: str | None = None


@router.get("/scheduled-bookings-by-route", response_model=List[ScheduledBookingsByRoute])
async def get_scheduled_bookings_by_route(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(requires_permission("view_scheduling_analytics")),
    db: AsyncSession = Depends(get_db),
):
    """Which routes get scheduled most, at roughly which hour, and from
    which pickup stage — real demand intelligence for route planning, same
    server-pre-aggregates-never-raw-rows principle as od-matrix/
    ridership-by-route above. Scoped by created_at (when the booking was
    made), not scheduled_departure, so this answers "what are people
    scheduling lately" rather than drifting with how far out they book."""
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)

    count_query = (
        select(
            ScheduledBooking.route_id,
            func.count(ScheduledBooking.id).label("scheduled_count"),
        )
        .where(ScheduledBooking.created_at >= since)
        .group_by(ScheduledBooking.route_id)
        .order_by(func.count(ScheduledBooking.id).desc())
    )
    count_rows = (await db.execute(count_query)).all()
    route_ids = [r.route_id for r in count_rows]
    if not route_ids:
        return []

    routes_result = await db.execute(select(Route).where(Route.id.in_(route_ids)))
    routes_by_id = {r.id: r for r in routes_result.scalars().all()}

    # Most common departure hour and top origin stage, per route — computed
    # in Python over the (already date-bounded) row set rather than a more
    # elaborate window-function query, since this table is small at
    # realistic scale (bounded by days) and this keeps the query portable
    # across SQLite dev and Postgres prod.
    detail_query = select(
        ScheduledBooking.route_id, ScheduledBooking.scheduled_departure, ScheduledBooking.origin_stage_id
    ).where(ScheduledBooking.route_id.in_(route_ids), ScheduledBooking.created_at >= since)
    detail_rows = (await db.execute(detail_query)).all()

    hours_by_route: dict[str, dict[int, int]] = {}
    origins_by_route: dict[str, dict[str, int]] = {}
    for row in detail_rows:
        hours = hours_by_route.setdefault(row.route_id, {})
        hour = row.scheduled_departure.hour
        hours[hour] = hours.get(hour, 0) + 1
        origins = origins_by_route.setdefault(row.route_id, {})
        origins[row.origin_stage_id] = origins.get(row.origin_stage_id, 0) + 1

    top_origin_ids = {max(origins, key=origins.get) for origins in origins_by_route.values() if origins}
    stages_result = await db.execute(select(Stage).where(Stage.id.in_(top_origin_ids))) if top_origin_ids else None
    stage_names = {s.id: s.name for s in stages_result.scalars().all()} if stages_result else {}

    results = []
    for r in count_rows:
        route = routes_by_id.get(r.route_id)
        hours = hours_by_route.get(r.route_id, {})
        origins = origins_by_route.get(r.route_id, {})
        top_origin_id = max(origins, key=origins.get) if origins else None
        results.append(ScheduledBookingsByRoute(
            route_id=r.route_id,
            route_name=route.name if route else r.route_id,
            route_code=route.code if route else "",
            scheduled_count=r.scheduled_count,
            most_common_hour=max(hours, key=hours.get) if hours else None,
            top_origin_stage_id=top_origin_id,
            top_origin_stage_name=stage_names.get(top_origin_id) if top_origin_id else None,
        ))
    return results
