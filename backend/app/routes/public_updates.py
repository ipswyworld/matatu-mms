"""
Public, unauthenticated "Live Updates" feed for the passenger-facing login
screen (matatu-mms-public). Deliberately separate from /api/route-detours
(staff-gated, app/routes/deviations.py) rather than adding an `if not
current_user` branch there — this endpoint exposes only the fields safe to
show to anyone with no session at all: which route has an active detour,
what the alternate is, and when it started. No vehicle registration
numbers, no GPS deviation points (that's DeviationAlert, an enforcement
signal, not a citizen traffic update), no staff-only data of any kind.
"""
import datetime
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models import ConditionReport, RouteDetour, User
from app.schemas import GuardianApprovalInfo, GuardianApproveRequest
from app.traffic import get_tomtom_incidents

router = APIRouter(prefix="/api/public", tags=["Public Live Updates"])

CONDITION_CATEGORIES = {"RAIN", "TRAFFIC_JAM", "ACCIDENT", "ROAD_BLOCKED", "POLICE_CHECK", "OTHER"}
# How long a crowdsourced report stays "live" — road/weather conditions
# change fast, so nothing here is ever marked reviewed/resolved; it just
# ages out of the read query. Long enough that a report survives a normal
# few-vehicle confirmation window, short enough it never reads as stale.
CONDITION_FRESHNESS = datetime.timedelta(minutes=90)


def _as_aware_utc(dt: datetime.datetime) -> datetime.datetime:
    """Same SQLite-loses-tzinfo issue as routes/auth.py's helper of the
    same name — a value read back after a fresh SELECT comes back naive
    even though it was written UTC-aware. No-op on Postgres."""
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)


class PublicRouteAlert(BaseModel):
    route_code: str
    route_name: str
    from_stage: str
    to_stage: str
    description: str
    since: datetime.datetime


@router.get("/route-alerts", response_model=List[PublicRouteAlert])
async def list_public_route_alerts():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(RouteDetour)
            .options(
                selectinload(RouteDetour.route),
                selectinload(RouteDetour.from_stage),
                selectinload(RouteDetour.to_stage),
            )
            .where(RouteDetour.active == True)
            .order_by(RouteDetour.created_at.desc())
        )
        detours = result.scalars().all()
        return [
            PublicRouteAlert(
                route_code=d.route.code,
                route_name=d.route.name,
                from_stage=d.from_stage.name,
                to_stage=d.to_stage.name,
                description=d.alternate_description,
                since=_as_aware_utc(d.created_at),
            )
            for d in detours
        ]


class ConditionReportCreate(BaseModel):
    category: str
    location_label: str
    message: Optional[str] = None


class ConditionReportOut(BaseModel):
    id: str
    category: str
    location_label: str
    message: Optional[str] = None
    created_at: datetime.datetime
    report_count: int  # how many matching reports landed in the freshness window
    # CROWDSOURCED (a real person typed this) or TOMTOM (TomTom's own
    # probe-vehicle/sensor network) — the frontend badges these differently
    # so "3 people reported this" and "TomTom is reporting this" read as the
    # distinct kinds of confidence they actually are.
    source: str = "CROWDSOURCED"


@router.post("/conditions", status_code=status.HTTP_201_CREATED)
async def submit_condition_report(payload: ConditionReportCreate):
    """Zero-friction crowdsourced signal — "it's raining", "jam on Waiyaki
    Way" — no login required. Deliberately not validated against real
    stage/location data (app.models.Stage): the whole point is a passenger
    can type roughly where they are without picking from a list."""
    category = payload.category.strip().upper()
    if category not in CONDITION_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown condition category.")
    location = payload.location_label.strip()
    if not location:
        raise HTTPException(status_code=400, detail="Tell us roughly where.")

    async with AsyncSessionLocal() as db:
        report = ConditionReport(
            id=f"cond-{uuid.uuid4().hex[:10]}",
            category=category,
            location_label=location,
            message=(payload.message or "").strip() or None,
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(report)
        await db.commit()
    return {"ok": True}


@router.get("/conditions", response_model=List[ConditionReportOut])
async def list_condition_reports():
    """The "50/50" Live Updates feed: crowdsourced reports (a person typed
    "jam on Waiyaki Way" seconds ago) merged with TomTom's live Traffic
    Incident data for Nairobi (app/traffic.py) — one half catches what's
    happening on a road right now even with no official sensor there, the
    other catches incidents across the whole city regardless of whether any
    app user happens to be nearby. Crowdsourced entries are still collapsed
    by (category, location) with a corroboration count; TomTom entries are
    already deduplicated incidents, so they pass through as-is, sorted in
    together by recency."""
    cutoff = datetime.datetime.now(datetime.timezone.utc) - CONDITION_FRESHNESS
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ConditionReport)
            .where(ConditionReport.created_at >= cutoff)
            .order_by(ConditionReport.created_at.desc())
        )
        reports = result.scalars().all()

    counts: dict[tuple[str, str], int] = {}
    latest_by_key: dict[tuple[str, str], ConditionReport] = {}
    for r in reports:
        key = (r.category, r.location_label.strip().lower())
        counts[key] = counts.get(key, 0) + 1
        if key not in latest_by_key:
            latest_by_key[key] = r  # first hit is the newest, since the query is already ordered desc

    crowdsourced = [
        ConditionReportOut(
            id=r.id, category=r.category, location_label=r.location_label,
            message=r.message, created_at=_as_aware_utc(r.created_at),
            report_count=counts[(r.category, r.location_label.strip().lower())],
            source="CROWDSOURCED",
        )
        for r in latest_by_key.values()
    ]

    tomtom_incidents = await get_tomtom_incidents()
    official = [
        ConditionReportOut(
            id=i["id"], category=i["category"], location_label=i["location_label"],
            message=i["message"], created_at=i["created_at"], report_count=1,
            source="TOMTOM",
        )
        for i in tomtom_incidents
    ]

    return sorted(crowdsourced + official, key=lambda c: c.created_at, reverse=True)


async def _find_valid_guardian_token(db, token: str) -> User:
    result = await db.execute(select(User).where(User.guardian_approval_token == token))
    user = result.scalars().first()
    if not user or not user.guardian_approval_token_expires_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This approval link is invalid.")
    if datetime.datetime.now(datetime.timezone.utc) > _as_aware_utc(user.guardian_approval_token_expires_at):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This approval link has expired.")
    return user


@router.get("/guardian-approve", response_model=GuardianApprovalInfo)
async def get_guardian_approval_info(token: str):
    """What the guardian sees before tapping Approve — deliberately just
    the two names, not the minor's phone/email or any other account
    detail, since reaching this page requires no login at all."""
    async with AsyncSessionLocal() as db:
        user = await _find_valid_guardian_token(db, token)
        return GuardianApprovalInfo(minor_name=user.name, guardian_name=user.guardian_name or "")


@router.post("/guardian-approve")
async def approve_guardian_request(payload: GuardianApproveRequest):
    async with AsyncSessionLocal() as db:
        user = await _find_valid_guardian_token(db, payload.token)
        user.guardian_approved = True
        user.guardian_approved_at = datetime.datetime.now(datetime.timezone.utc)
        user.guardian_approval_token = None
        user.guardian_approval_token_expires_at = None
        await db.commit()
        return {"message": f"{user.name}'s account has been approved. They can now sign in."}
