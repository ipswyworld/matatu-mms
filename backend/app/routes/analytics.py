"""
Server-side pre-aggregation for dashboard charts (ARCHITECTURE_DECISIONS.md
§23.3) — "the single most important piece: the difference between a 200ms
dashboard and one that times out." Chart endpoints take (metric,
date_range, grouping) and return bucketed rows, never raw per-row data —
a year-long trend becomes ~365 pre-computed points, not a browser-side
scan of every row in that year.

Full TimescaleDB continuous aggregates (materialized, incrementally
refreshed rollups) are the eventual target once vehicle_positions-style
volume exists for these tables too — this endpoint computes the
aggregation live via `date_trunc`/`GROUP BY` on every request, which is
the correct interim shape (still O(buckets) returned to the client, still
never ships raw rows) and the natural migration path to a continuous
aggregate later: the query shape doesn't change, only where the grouped
rows come from.
"""
import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db, IS_SQLITE
from app.models import Fine, Booking, Matatu, Trip, User
from app.schemas import TimeseriesResponse, TimeseriesPoint
from app.auth import requires_permission
from app.abac import sacco_scope_query

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])

METRICS = {
    # metric name -> (model, timestamp_column, value_column_or_None, sacco_join_column)
    "fines": (Fine, "issued_at", "amount_kes", "sacco_id_via_matatu"),
    "bookings": (Booking, "booked_at", "fare_kes", "sacco_id_via_matatu"),
    # Real ridership, distinct from "bookings" (app-based seat reservations
    # only) — crew's own headcount estimate logged at trip completion
    # (Trip.passenger_count, nullable). Most crews won't log every trip, so
    # an untouched trip must read as missing data, not a real zero — see
    # get_timeseries()'s count(value_col) below, which naturally skips NULL
    # passenger_count rows (unlike count(model.id), which would count every
    # completed AND cancelled trip regardless of whether headcount exists).
    "ridership": (Trip, "ended_at", "passenger_count", "sacco_id_via_matatu"),
}

GROUPINGS = {"day", "week", "month"}


def _date_trunc(grouping: str, column):
    if IS_SQLITE:
        # SQLite has no date_trunc; strftime gives day/month buckets
        # directly, week is approximated as day (exact ISO-week bucketing
        # isn't available in SQLite's strftime) — fine for the local/CI
        # fast path, which never validates chart correctness at the pixel
        # level anyway. The Postgres integration job exercises the real
        # date_trunc path below.
        fmt = {"day": "%Y-%m-%d", "week": "%Y-%m-%d", "month": "%Y-%m-01"}[grouping]
        return func.strftime(fmt, column)
    return cast(func.date_trunc(grouping, column), Date)


@router.get("/timeseries", response_model=TimeseriesResponse)
async def get_timeseries(
    metric: str = Query(..., description="fines | bookings | ridership"),
    days: int = Query(30, ge=1, le=730, description="Lookback window in days from today."),
    grouping: str = Query("day", description="day | week | month"),
    current_user: User = Depends(requires_permission("view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    if metric not in METRICS:
        raise HTTPException(status_code=400, detail=f"Unknown metric. Choose one of: {', '.join(METRICS)}")
    if grouping not in GROUPINGS:
        raise HTTPException(status_code=400, detail=f"Unknown grouping. Choose one of: {', '.join(GROUPINGS)}")

    model, ts_col_name, value_col_name, _ = METRICS[metric]
    ts_col = getattr(model, ts_col_name)
    value_col = getattr(model, value_col_name)

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    bucket = _date_trunc(grouping, ts_col)

    query = (
        select(
            bucket.label("bucket"),
            # count(value_col), not count(model.id): for "ridership" this
            # must only count trips with a logged headcount, not every
            # completed trip — a no-op change for fines/bookings since
            # their value columns are never null.
            func.count(value_col).label("count"),
            func.coalesce(func.sum(value_col), 0).label("value"),
        )
        .where(ts_col >= since)
        .group_by(bucket)
        .order_by(bucket)
    )
    # Both Fine and Booking reach their Sacco through Matatu — scope a Sacco
    # Operator/Crew account to their own fleet the same way every other
    # aggregate/list endpoint does, so a dashboard chart can never surface
    # another Sacco's fine/revenue totals even in bucketed form.
    if current_user.role in ("SACCO_OPERATOR", "CREW"):
        query = query.join(Matatu, model.matatu_id == Matatu.id)
        query = sacco_scope_query(current_user, query, Matatu.sacco_id)

    result = await db.execute(query)
    points: List[TimeseriesPoint] = []
    for row in result.all():
        raw_bucket = row.bucket
        if isinstance(raw_bucket, str):
            raw_bucket = datetime.date.fromisoformat(raw_bucket)
        points.append(TimeseriesPoint(bucket=raw_bucket, count=row.count, value=float(row.value)))

    return TimeseriesResponse(metric=metric, grouping=grouping, points=points)
