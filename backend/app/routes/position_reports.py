"""
Crowdsourced vehicle-position sanity check (#16 of the journey-planning
plan). A matatu's live position is entirely self-reported by the crew
device (telemetry.py) — nothing in this system independently verifies it.
This lets any authenticated user who believes they're physically near a
specific matatu submit their own GPS; the backend compares it against that
vehicle's currently-claimed live position and records the discrepancy.

Consensus, not single reports, is what actually means anything here — see
VehiclePositionReport's own docstring in app/models.py for why. A single
report never flags a vehicle as disputed on its own; disputed-vehicles
below requires multiple *distinct* reporters within a short window.
"""
import datetime
import json
import math
import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import VehiclePositionReport, Matatu, User
from app.schemas import VehiclePositionReportCreate, VehiclePositionReportResponse, DisputedVehicleResult
from app.auth import get_current_user, requires_permission
from app.realtime import get_redis
from app.routes.telemetry import TELEMETRY_KEY_PREFIX

router = APIRouter(tags=["Vehicle Position Reports"])


def _haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

# A reporter's own GPS routinely drifts 50-100m in dense Nairobi; 500m is a
# deliberately generous floor so ordinary GPS noise never gets flagged —
# only a discrepancy consistent with the telemetry being outright wrong.
DISCREPANCY_THRESHOLD_METERS = 500.0

# One report proves nothing (see the module/model docstrings) — this many
# *distinct* reporters, each independently flagging the same vehicle within
# the window below, is the actual signal.
CONSENSUS_MIN_DISTINCT_REPORTERS = 2
CONSENSUS_WINDOW_MINUTES = 15

# Cheap per-reporter throttle: stops one account from spamming reports for
# the same vehicle to game the consensus count on its own.
REPORT_COOLDOWN_MINUTES = 2


@router.post("/api/telemetry/sanity-reports", response_model=VehiclePositionReportResponse, status_code=201)
async def submit_position_report(
    payload: VehiclePositionReportCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    matatu = (await db.execute(select(Matatu).where(Matatu.id == payload.matatu_id))).scalars().first()
    if not matatu:
        raise HTTPException(status_code=404, detail="Matatu not found")

    now = datetime.datetime.now(datetime.timezone.utc)
    recent = (
        await db.execute(
            select(VehiclePositionReport).where(
                VehiclePositionReport.matatu_id == payload.matatu_id,
                VehiclePositionReport.reporter_user_id == current_user.id,
                VehiclePositionReport.created_at >= now - datetime.timedelta(minutes=REPORT_COOLDOWN_MINUTES),
            )
        )
    ).scalars().first()
    if recent:
        raise HTTPException(status_code=429, detail="You've already reported this vehicle recently — try again shortly.")

    r = await get_redis()
    raw = await r.get(f"{TELEMETRY_KEY_PREFIX}{payload.matatu_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="This vehicle has no live position to check against right now.")
    try:
        data = json.loads(raw)
        claimed_lat, claimed_lng = float(data["lat"]), float(data["lng"])
    except (ValueError, TypeError, KeyError):
        raise HTTPException(status_code=404, detail="This vehicle's live position is currently unreadable.")

    discrepancy = _haversine_meters(payload.reporter_lat, payload.reporter_lng, claimed_lat, claimed_lng)
    flagged = discrepancy > DISCREPANCY_THRESHOLD_METERS

    report = VehiclePositionReport(
        id=f"vpr-{secrets.token_hex(6)}",
        matatu_id=payload.matatu_id,
        reporter_user_id=current_user.id,
        reporter_lat=payload.reporter_lat,
        reporter_lng=payload.reporter_lng,
        claimed_lat=claimed_lat,
        claimed_lng=claimed_lng,
        discrepancy_meters=discrepancy,
        flagged=flagged,
        created_at=now,
    )
    db.add(report)
    await db.commit()

    return VehiclePositionReportResponse(
        id=report.id, matatu_id=report.matatu_id,
        discrepancy_meters=report.discrepancy_meters, flagged=report.flagged,
        created_at=report.created_at,
    )


@router.get("/api/telemetry/disputed-vehicles", response_model=List[DisputedVehicleResult])
async def list_disputed_vehicles(
    current_user: User = Depends(requires_permission("view_activity")),
    db: AsyncSession = Depends(get_db),
):
    """Same permission gate as GET /api/deviation-alerts — both are
    "something looks off with a vehicle's position, a human should look"
    signals for the same audience."""
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=CONSENSUS_WINDOW_MINUTES)
    reports = (
        await db.execute(
            select(VehiclePositionReport)
            .options(selectinload(VehiclePositionReport.matatu))
            .where(
                VehiclePositionReport.flagged == True,  # noqa: E712
                VehiclePositionReport.resolved == False,  # noqa: E712
                VehiclePositionReport.created_at >= cutoff,
            )
            .order_by(VehiclePositionReport.created_at.desc())
        )
    ).scalars().all()

    by_matatu: dict[str, list[VehiclePositionReport]] = {}
    for rep in reports:
        by_matatu.setdefault(rep.matatu_id, []).append(rep)

    disputed: List[DisputedVehicleResult] = []
    for matatu_id, reps in by_matatu.items():
        distinct_reporters = {rep.reporter_user_id for rep in reps}
        if len(distinct_reporters) < CONSENSUS_MIN_DISTINCT_REPORTERS:
            continue
        latest = reps[0]  # already ordered by created_at desc
        disputed.append(DisputedVehicleResult(
            matatu_id=matatu_id,
            reg_number=latest.matatu.reg_number if latest.matatu else matatu_id,
            report_count=len(reps),
            distinct_reporters=len(distinct_reporters),
            latest_discrepancy_meters=latest.discrepancy_meters,
            latest_claimed_lat=latest.claimed_lat,
            latest_claimed_lng=latest.claimed_lng,
            latest_reported_at=latest.created_at,
        ))

    disputed.sort(key=lambda d: d.distinct_reporters, reverse=True)
    return disputed


@router.patch("/api/telemetry/sanity-reports/{matatu_id}/resolve")
async def resolve_position_reports(
    matatu_id: str,
    current_user: User = Depends(requires_permission("view_activity")),
    db: AsyncSession = Depends(get_db),
):
    """Dismisses every currently-unresolved flagged report for this vehicle
    at once — a dispute is a cluster of reports, not a single row, so
    resolving it means resolving the whole cluster (crew GPS was delayed,
    device clock skew, etc.), matching how a human actually investigates
    this rather than clicking through reports one at a time."""
    reports = (
        await db.execute(
            select(VehiclePositionReport).where(
                VehiclePositionReport.matatu_id == matatu_id,
                VehiclePositionReport.flagged == True,  # noqa: E712
                VehiclePositionReport.resolved == False,  # noqa: E712
            )
        )
    ).scalars().all()
    if not reports:
        raise HTTPException(status_code=404, detail="No unresolved position reports for this vehicle")
    for rep in reports:
        rep.resolved = True
    await db.commit()
    return {"resolved": len(reports)}
