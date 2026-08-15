"""
Route-deviation detection (ARCHITECTURE_DECISIONS.md §1.6, §29.4) — "alert
if straying." A true buffered-polygon check needs a real route polyline in
PostGIS; what exists today is a sequence of stage waypoints (Task 8's BRN
digitization), so this implements the honest version of that check now:
distance from a live position to the nearest stage-to-stage segment along
the vehicle's assigned route, flagged if it exceeds a fixed tolerance.
Rule-based and fully explainable, per the doc's explicit "no ML for v1 —
a government safety feature needs a concrete answer for why the system
flagged this, not a black-box inference."

Migrating this to a real PostGIS buffered polygon (ST_DWithin against a
route LineString) is the natural upgrade once route polylines exist beyond
stage waypoints — the call site (telemetry.py) wouldn't need to change,
only this function's internals.
"""
import datetime
import math
import secrets
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import DeviationAlert, Matatu, RouteStage, Stage

DEVIATION_TOLERANCE_METERS = 500.0
EARTH_RADIUS_METERS = 6_371_000


def _haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return EARTH_RADIUS_METERS * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _distance_to_segment_meters(lat: float, lng: float, a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    """Approximate point-to-segment distance by projecting onto the
    segment in a local equirectangular projection — accurate enough at
    city scale (a few km segments) without a full geodesic library."""
    lat_scale = EARTH_RADIUS_METERS * math.pi / 180
    lng_scale = lat_scale * math.cos(math.radians(lat))

    px, py = lng * lng_scale, lat * lat_scale
    ax, ay = a_lng * lng_scale, a_lat * lat_scale
    bx, by = b_lng * lng_scale, b_lat * lat_scale

    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0:
        return math.hypot(px - ax, py - ay)

    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))
    proj_x, proj_y = ax + t * dx, ay + t * dy
    return math.hypot(px - proj_x, py - proj_y)


async def check_deviation(db: AsyncSession, matatu_id: str, lat: float, lng: float) -> Optional[DeviationAlert]:
    """Best-effort: never raises. Returns the created DeviationAlert if the
    position is outside tolerance for the vehicle's assigned route and has
    known, geocoded stage waypoints; None otherwise (including when there's
    nothing to check against — an ungeocoded stage isn't treated as a
    false deviation, matching Stage.geocoded's own honesty rule)."""
    matatu = (await db.execute(select(Matatu).where(Matatu.id == matatu_id))).scalars().first()
    if not matatu:
        return None

    route_stages = (
        await db.execute(
            select(RouteStage)
            .where(RouteStage.route_id == matatu.route_id, RouteStage.direction == "OUTBOUND")
            .order_by(RouteStage.sequence)
        )
    ).scalars().all()
    if len(route_stages) < 2:
        return None

    stage_ids = [rs.stage_id for rs in route_stages]
    stages_result = await db.execute(select(Stage).where(Stage.id.in_(stage_ids)))
    stages_by_id = {s.id: s for s in stages_result.scalars().all()}

    min_distance = None
    for rs_a, rs_b in zip(route_stages, route_stages[1:]):
        stage_a, stage_b = stages_by_id.get(rs_a.stage_id), stages_by_id.get(rs_b.stage_id)
        if not stage_a or not stage_b or not stage_a.geocoded or not stage_b.geocoded:
            continue
        d = _distance_to_segment_meters(lat, lng, stage_a.lat, stage_a.lng, stage_b.lat, stage_b.lng)
        if min_distance is None or d < min_distance:
            min_distance = d

    if min_distance is None or min_distance <= DEVIATION_TOLERANCE_METERS:
        return None

    alert = DeviationAlert(
        id=f"dev-{secrets.token_hex(4)}",
        matatu_id=matatu_id,
        route_id=matatu.route_id,
        lat=lat,
        lng=lng,
        distance_meters=min_distance,
        detected_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(alert)
    return alert
