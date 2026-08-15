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
from app.models import DemandSignal, Stage, User
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
