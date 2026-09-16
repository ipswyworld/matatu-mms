"""
PTCU duty allocation — sectors, zones, monthly postings, and officer duty
status.

This is the digital form of the county's real paper process: the Section
Commander of the Public Transport Control Unit issues one signed
"ALLOCATION OF DUTY" sheet per month to the Director of City Inspectorate,
organised Section -> Sector (1-11, plus 5B) -> Zone (1-13) -> officer, with
each officer's NAME, MAN. NO, RANK, WORK STATION, SHIFT and duty status.

Deliberately additive alongside app/routes/beats.py rather than replacing
it. The two answer different questions and both are real:

  * A BeatAssignment is "Officer X patrols this route-segment from 0800 to
    1600 on the 14th" — a time-boxed patrol slot on a stretch of one route.
  * A DutyAssignment here is "Officer X holds the Khoja/Kilome Road posting
    in Zone 1, day shift, for September" — the monthly establishment.

Folding them together would have meant either forcing the monthly sheet
into per-day datetime rows (153 officers x 30 days = ~4,600 rows a month to
express what the sheet says in 153 lines), or weakening the patrol record
into something too coarse to schedule against. They stay separate.

`coverage` (DAILY / WEEKDAY / WEEKEND) is how the sheet's daily and weekend
allocations live in one document: resolving "who is posted on the 14th" is
a filter on coverage against that date's weekday, not a second document.
"""
import calendar
import datetime
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.audit import stage_audit_log
from app.auth import get_current_user, requires_permission
from app.database import get_db
from app.events import dispatcher
from app.models import (
    Broadcast,
    BroadcastRecipient,
    DutyAllocation,
    DutyAssignment,
    Sector,
    User,
    Zone,
)
from app.rbac import ENFORCEMENT_ROLES
from app.routes.notifications import notify_user
from app.schemas import (
    DutyAllocationCreate,
    DutyAllocationResponse,
    DutyAssignmentCreate,
    DutyAssignmentResponse,
    DutyAssignmentUpdate,
    DutyCalendarDay,
    DutyCalendarResponse,
    MyDutyResponse,
    OfficerDutyStatusUpdate,
    OfficerRosterResponse,
    OfficerServiceUpdate,
    SectorResponse,
    SectorUpsert,
    ZoneResponse,
    ZoneUpsert,
)

router = APIRouter(prefix="/api/duty", tags=["Duty Allocation"])

DUTY_STATUSES = {"ON_DUTY", "OFF_DUTY", "LEAVE", "SICK", "SUSPENDED", "TRAINING"}
SHIFTS = {"DAY", "NOON", "NIGHT"}
COVERAGES = {"DAILY", "WEEKDAY", "WEEKEND"}
ALLOCATION_STATUSES = {"DRAFT", "PUBLISHED", "ARCHIVED"}

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _covers_date(coverage: str, day: datetime.date) -> bool:
    """Saturday=5, Sunday=6 in Python's weekday(). A WEEKEND posting is
    exactly those two; WEEKDAY is the other five; DAILY is both."""
    if coverage == "DAILY":
        return True
    is_weekend = day.weekday() >= 5
    return is_weekend if coverage == "WEEKEND" else not is_weekend


def _assignment_applies_on(assignment: DutyAssignment, day: datetime.date) -> bool:
    if not _covers_date(assignment.coverage, day):
        return False
    if assignment.effective_from and day < assignment.effective_from:
        return False
    if assignment.effective_to and day > assignment.effective_to:
        return False
    return True


# --------------------------------------------------------------------------
# Serializers
# --------------------------------------------------------------------------

def _sector_to_response(sector: Sector, zone_count: int = 0, officer_count: int = 0) -> SectorResponse:
    return SectorResponse(
        id=sector.id,
        code=sector.code,
        name=sector.name,
        description=sector.description,
        commander_id=sector.commander_id,
        commander_name=sector.commander.name if sector.commander else None,
        deputy_commander_id=sector.deputy_commander_id,
        deputy_commander_name=sector.deputy_commander.name if sector.deputy_commander else None,
        contact_phone=sector.contact_phone,
        center_lat=sector.center_lat,
        center_lng=sector.center_lng,
        boundary_geojson=sector.boundary_geojson,
        display_order=sector.display_order,
        is_active=sector.is_active,
        zone_count=zone_count,
        officer_count=officer_count,
    )


def _zone_to_response(zone: Zone, officer_count: int = 0) -> ZoneResponse:
    return ZoneResponse(
        id=zone.id,
        name=zone.name,
        description=zone.description,
        sector_id=zone.sector_id,
        sector_code=zone.sector.code if zone.sector else None,
        sector_name=zone.sector.name if zone.sector else None,
        code=zone.code,
        center_lat=zone.center_lat,
        center_lng=zone.center_lng,
        boundary_geojson=zone.boundary_geojson,
        display_order=zone.display_order,
        is_active=zone.is_active,
        officer_count=officer_count,
    )


def _assignment_to_response(a: DutyAssignment) -> DutyAssignmentResponse:
    return DutyAssignmentResponse(
        id=a.id,
        allocation_id=a.allocation_id,
        officer_id=a.officer_id,
        officer_name=a.officer.name if a.officer else "(removed)",
        officer_rank=a.officer.rank if a.officer else None,
        officer_manpower_no=a.officer.manpower_no if a.officer else None,
        officer_phone=a.officer.phone if a.officer else None,
        officer_duty_status=a.officer.duty_status if a.officer else "ON_DUTY",
        sector_id=a.sector_id,
        sector_code=a.sector.code if a.sector else None,
        sector_name=a.sector.name if a.sector else None,
        zone_id=a.zone_id,
        zone_name=a.zone.name if a.zone else None,
        work_station=a.work_station,
        shift=a.shift,
        coverage=a.coverage,
        effective_from=a.effective_from,
        effective_to=a.effective_to,
        posting_role=a.posting_role,
        notes=a.notes,
        created_at=a.created_at,
    )


async def _allocation_to_response(db: AsyncSession, alloc: DutyAllocation) -> DutyAllocationResponse:
    """Totals are computed here rather than stored: the sheet's own footer
    (MALE ON DUTY / FEMALE ON DUTY / SECTION TOTAL) is a count of the rows
    above it, and a stored copy would be one edit away from disagreeing
    with them."""
    rows = (
        await db.execute(
            select(User.gender, func.count(func.distinct(DutyAssignment.officer_id)))
            .join(User, User.id == DutyAssignment.officer_id)
            .where(DutyAssignment.allocation_id == alloc.id)
            .group_by(User.gender)
        )
    ).all()
    male = sum(c for g, c in rows if g == "M")
    female = sum(c for g, c in rows if g == "F")
    total = sum(c for _, c in rows)

    count = (
        await db.execute(
            select(func.count(DutyAssignment.id)).where(DutyAssignment.allocation_id == alloc.id)
        )
    ).scalar() or 0

    return DutyAllocationResponse(
        id=alloc.id,
        year=alloc.year,
        month=alloc.month,
        reference_no=alloc.reference_no,
        title=alloc.title,
        status=alloc.status,
        notes=alloc.notes,
        created_by=alloc.created_by,
        created_by_name=alloc.creator.name if alloc.creator else None,
        created_at=alloc.created_at,
        published_by=alloc.published_by,
        published_by_name=alloc.publisher.name if alloc.publisher else None,
        published_at=alloc.published_at,
        assignment_count=count,
        male_on_duty=male,
        female_on_duty=female,
        total_assigned=total,
    )


# --------------------------------------------------------------------------
# Sectors
# --------------------------------------------------------------------------

@router.get("/sectors", response_model=List[SectorResponse])
async def list_sectors(
    allocation_id: Optional[str] = Query(None, description="Count officers posted in this allocation"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("view_routes")),
):
    """Every sector, with its zone count and — when an allocation is named —
    how many officers are posted to it. That count is what a commander
    reads off a sector tile before drilling in."""
    result = await db.execute(
        select(Sector)
        .options(selectinload(Sector.commander), selectinload(Sector.deputy_commander))
        .order_by(Sector.display_order, Sector.code)
    )
    sectors = result.scalars().all()

    zone_counts = dict(
        (
            await db.execute(
                select(Zone.sector_id, func.count(Zone.id))
                .where(Zone.sector_id.isnot(None))
                .group_by(Zone.sector_id)
            )
        ).all()
    )

    officer_counts: dict = {}
    if allocation_id:
        # A posting counts toward its sector whether it names the sector
        # directly (sector command) or a zone inside it (the usual case),
        # so both paths are unioned rather than counting only the direct one.
        direct = (
            await db.execute(
                select(DutyAssignment.sector_id, func.count(func.distinct(DutyAssignment.officer_id)))
                .where(
                    DutyAssignment.allocation_id == allocation_id,
                    DutyAssignment.sector_id.isnot(None),
                )
                .group_by(DutyAssignment.sector_id)
            )
        ).all()
        via_zone = (
            await db.execute(
                select(Zone.sector_id, func.count(func.distinct(DutyAssignment.officer_id)))
                .join(Zone, Zone.id == DutyAssignment.zone_id)
                .where(
                    DutyAssignment.allocation_id == allocation_id,
                    Zone.sector_id.isnot(None),
                )
                .group_by(Zone.sector_id)
            )
        ).all()
        for sector_id, count in list(direct) + list(via_zone):
            officer_counts[sector_id] = officer_counts.get(sector_id, 0) + count

    return [
        _sector_to_response(s, zone_counts.get(s.id, 0), officer_counts.get(s.id, 0))
        for s in sectors
    ]


@router.post("/sectors", response_model=SectorResponse, status_code=status.HTTP_201_CREATED)
async def create_sector(
    payload: SectorUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    existing = (await db.execute(select(Sector).where(Sector.code == payload.code.strip()))).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Sector {payload.code} already exists.")

    sector = Sector(
        id=f"sector-{secrets.token_hex(4)}",
        code=payload.code.strip(),
        name=payload.name.strip(),
        description=payload.description,
        commander_id=payload.commander_id or None,
        deputy_commander_id=payload.deputy_commander_id or None,
        contact_phone=payload.contact_phone or None,
        center_lat=payload.center_lat,
        center_lng=payload.center_lng,
        boundary_geojson=payload.boundary_geojson,
        display_order=payload.display_order,
        is_active=True,
        created_at=_now(),
    )
    db.add(sector)
    stage_audit_log(
        db, resource_type="sector", resource_id=sector.id, action="CREATE",
        user_id=current_user.id, new_values={"code": sector.code, "name": sector.name},
    )
    await db.commit()
    await db.refresh(sector)
    return _sector_to_response(sector)


@router.patch("/sectors/{sector_id}", response_model=SectorResponse)
async def update_sector(
    sector_id: str,
    payload: SectorUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    sector = (
        await db.execute(
            select(Sector)
            .options(selectinload(Sector.commander), selectinload(Sector.deputy_commander))
            .where(Sector.id == sector_id)
        )
    ).scalars().first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector not found.")

    old = {"code": sector.code, "name": sector.name, "commanderId": sector.commander_id}
    sector.code = payload.code.strip()
    sector.name = payload.name.strip()
    sector.description = payload.description
    sector.commander_id = payload.commander_id or None
    sector.deputy_commander_id = payload.deputy_commander_id or None
    sector.contact_phone = payload.contact_phone or None
    sector.center_lat = payload.center_lat
    sector.center_lng = payload.center_lng
    sector.boundary_geojson = payload.boundary_geojson
    sector.display_order = payload.display_order

    stage_audit_log(
        db, resource_type="sector", resource_id=sector.id, action="UPDATE",
        user_id=current_user.id, old_values=old,
        new_values={"code": sector.code, "name": sector.name, "commanderId": sector.commander_id},
    )
    await db.commit()
    await db.refresh(sector)
    return _sector_to_response(sector)


# --------------------------------------------------------------------------
# Zones
# --------------------------------------------------------------------------

@router.get("/zones", response_model=List[ZoneResponse])
async def list_duty_zones(
    sector_id: Optional[str] = Query(None),
    allocation_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("view_routes")),
):
    query = select(Zone).options(selectinload(Zone.sector))
    if sector_id:
        query = query.where(Zone.sector_id == sector_id)
    zones = (await db.execute(query.order_by(Zone.display_order, Zone.name))).scalars().all()

    officer_counts: dict = {}
    if allocation_id:
        officer_counts = dict(
            (
                await db.execute(
                    select(DutyAssignment.zone_id, func.count(func.distinct(DutyAssignment.officer_id)))
                    .where(
                        DutyAssignment.allocation_id == allocation_id,
                        DutyAssignment.zone_id.isnot(None),
                    )
                    .group_by(DutyAssignment.zone_id)
                )
            ).all()
        )

    return [_zone_to_response(z, officer_counts.get(z.id, 0)) for z in zones]


@router.post("/zones", response_model=ZoneResponse, status_code=status.HTTP_201_CREATED)
async def create_duty_zone(
    payload: ZoneUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    if payload.sector_id:
        sector = (await db.execute(select(Sector).where(Sector.id == payload.sector_id))).scalars().first()
        if not sector:
            raise HTTPException(status_code=404, detail="Sector not found.")

    zone = Zone(
        id=f"zone-{secrets.token_hex(4)}",
        name=payload.name.strip(),
        description=payload.description,
        sector_id=payload.sector_id or None,
        code=payload.code or None,
        center_lat=payload.center_lat,
        center_lng=payload.center_lng,
        boundary_geojson=payload.boundary_geojson,
        display_order=payload.display_order,
        is_active=True,
    )
    db.add(zone)
    stage_audit_log(
        db, resource_type="zone", resource_id=zone.id, action="CREATE",
        user_id=current_user.id, new_values={"name": zone.name, "sectorId": zone.sector_id},
    )
    await db.commit()
    await db.refresh(zone)
    result = (
        await db.execute(select(Zone).options(selectinload(Zone.sector)).where(Zone.id == zone.id))
    ).scalars().first()
    return _zone_to_response(result)


@router.patch("/zones/{zone_id}", response_model=ZoneResponse)
async def update_duty_zone(
    zone_id: str,
    payload: ZoneUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    zone = (
        await db.execute(select(Zone).options(selectinload(Zone.sector)).where(Zone.id == zone_id))
    ).scalars().first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found.")

    old = {"name": zone.name, "sectorId": zone.sector_id}
    zone.name = payload.name.strip()
    zone.description = payload.description
    zone.sector_id = payload.sector_id or None
    zone.code = payload.code or None
    zone.center_lat = payload.center_lat
    zone.center_lng = payload.center_lng
    zone.boundary_geojson = payload.boundary_geojson
    zone.display_order = payload.display_order

    stage_audit_log(
        db, resource_type="zone", resource_id=zone.id, action="UPDATE",
        user_id=current_user.id, old_values=old,
        new_values={"name": zone.name, "sectorId": zone.sector_id},
    )
    await db.commit()
    await db.refresh(zone)
    refreshed = (
        await db.execute(select(Zone).options(selectinload(Zone.sector)).where(Zone.id == zone.id))
    ).scalars().first()
    return _zone_to_response(refreshed)


# --------------------------------------------------------------------------
# Monthly allocations
# --------------------------------------------------------------------------

@router.get("/allocations", response_model=List[DutyAllocationResponse])
async def list_allocations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("view_users")),
):
    allocations = (
        await db.execute(
            select(DutyAllocation)
            .options(selectinload(DutyAllocation.creator), selectinload(DutyAllocation.publisher))
            .order_by(DutyAllocation.year.desc(), DutyAllocation.month.desc())
        )
    ).scalars().all()
    return [await _allocation_to_response(db, a) for a in allocations]


@router.post("/allocations", response_model=DutyAllocationResponse, status_code=status.HTTP_201_CREATED)
async def create_allocation(
    payload: DutyAllocationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    existing = (
        await db.execute(
            select(DutyAllocation).where(
                DutyAllocation.year == payload.year, DutyAllocation.month == payload.month
            )
        )
    ).scalars().first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"An allocation for {MONTH_NAMES[payload.month]} {payload.year} already exists.",
        )

    alloc = DutyAllocation(
        id=f"alloc-{secrets.token_hex(5)}",
        year=payload.year,
        month=payload.month,
        reference_no=payload.reference_no,
        title=payload.title or f"{MONTH_NAMES[payload.month]} {payload.year} Duty Allocation",
        status="DRAFT",
        notes=payload.notes,
        created_by=current_user.id,
        created_at=_now(),
    )
    db.add(alloc)
    await db.flush()

    copied = 0
    if payload.copy_from_allocation_id:
        # Carry last month's postings forward. This is the difference
        # between a system a commander uses and one they abandon: a month's
        # sheet is last month's sheet amended, never 153 rows retyped.
        source = (
            await db.execute(
                select(DutyAssignment).where(
                    DutyAssignment.allocation_id == payload.copy_from_allocation_id
                )
            )
        ).scalars().all()
        for src in source:
            db.add(
                DutyAssignment(
                    id=f"da-{secrets.token_hex(5)}",
                    allocation_id=alloc.id,
                    officer_id=src.officer_id,
                    sector_id=src.sector_id,
                    zone_id=src.zone_id,
                    work_station=src.work_station,
                    shift=src.shift,
                    coverage=src.coverage,
                    # Date windows are deliberately NOT copied: "effective
                    # from the 12th" meant the 12th of the month it was
                    # written for, and carrying it into a new month would
                    # silently mis-post someone.
                    effective_from=None,
                    effective_to=None,
                    posting_role=src.posting_role,
                    notes=src.notes,
                    created_at=_now(),
                )
            )
            copied += 1

    stage_audit_log(
        db, resource_type="duty_allocation", resource_id=alloc.id, action="CREATE",
        user_id=current_user.id,
        new_values={"year": alloc.year, "month": alloc.month, "copiedAssignments": copied},
    )
    await db.commit()

    refreshed = (
        await db.execute(
            select(DutyAllocation)
            .options(selectinload(DutyAllocation.creator), selectinload(DutyAllocation.publisher))
            .where(DutyAllocation.id == alloc.id)
        )
    ).scalars().first()
    return await _allocation_to_response(db, refreshed)


@router.get("/allocations/{allocation_id}", response_model=DutyAllocationResponse)
async def get_allocation(
    allocation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("view_users")),
):
    alloc = (
        await db.execute(
            select(DutyAllocation)
            .options(selectinload(DutyAllocation.creator), selectinload(DutyAllocation.publisher))
            .where(DutyAllocation.id == allocation_id)
        )
    ).scalars().first()
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation not found.")
    return await _allocation_to_response(db, alloc)


@router.post("/allocations/{allocation_id}/publish", response_model=DutyAllocationResponse)
async def publish_allocation(
    allocation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    """Publishing is what makes a draft real: until now officers cannot see
    it, and after now every posted officer is told directly rather than
    finding out at parade."""
    alloc = (
        await db.execute(
            select(DutyAllocation)
            .options(selectinload(DutyAllocation.creator), selectinload(DutyAllocation.publisher))
            .where(DutyAllocation.id == allocation_id)
        )
    ).scalars().first()
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation not found.")
    if alloc.status == "PUBLISHED":
        raise HTTPException(status_code=400, detail="This allocation is already published.")

    assignments = (
        await db.execute(
            select(DutyAssignment)
            .options(selectinload(DutyAssignment.officer), selectinload(DutyAssignment.zone))
            .where(DutyAssignment.allocation_id == allocation_id)
        )
    ).scalars().all()
    if not assignments:
        raise HTTPException(
            status_code=400,
            detail="Nothing to publish — this allocation has no postings yet.",
        )

    alloc.status = "PUBLISHED"
    alloc.published_by = current_user.id
    alloc.published_at = _now()

    stage_audit_log(
        db, resource_type="duty_allocation", resource_id=alloc.id, action="PUBLISH",
        user_id=current_user.id,
        new_values={"assignmentCount": len(assignments), "month": alloc.month, "year": alloc.year},
    )
    await db.commit()

    period = f"{MONTH_NAMES[alloc.month]} {alloc.year}"
    notified: set = set()
    for a in assignments:
        if a.officer_id in notified:
            continue
        notified.add(a.officer_id)
        where = a.zone.name if a.zone else a.work_station
        await notify_user(
            a.officer_id,
            title=f"{period} duty allocation published",
            message=f"You are posted to {where} ({a.shift.title()} shift).",
            level="info",
        )

    dispatcher.dispatch(
        "DUTY_ALLOCATION_PUBLISHED",
        {"allocation_id": alloc.id, "year": alloc.year, "month": alloc.month,
         "officers": len(notified), "published_by": current_user.id},
    )

    refreshed = (
        await db.execute(
            select(DutyAllocation)
            .options(selectinload(DutyAllocation.creator), selectinload(DutyAllocation.publisher))
            .where(DutyAllocation.id == alloc.id)
        )
    ).scalars().first()
    return await _allocation_to_response(db, refreshed)


# --------------------------------------------------------------------------
# Postings within an allocation
# --------------------------------------------------------------------------

def _assignment_query():
    return select(DutyAssignment).options(
        selectinload(DutyAssignment.officer),
        selectinload(DutyAssignment.sector),
        selectinload(DutyAssignment.zone),
    )


@router.get("/allocations/{allocation_id}/assignments", response_model=List[DutyAssignmentResponse])
async def list_assignments(
    allocation_id: str,
    sector_id: Optional[str] = Query(None),
    zone_id: Optional[str] = Query(None),
    shift: Optional[str] = Query(None),
    on_date: Optional[datetime.date] = Query(None, description="Only postings that apply on this date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("view_users")),
):
    """The drill-down: pick a sector or a zone, get the officers posted
    there. `on_date` additionally resolves DAILY/WEEKDAY/WEEKEND coverage
    against a real date, which is what the calendar's day view needs."""
    query = _assignment_query().where(DutyAssignment.allocation_id == allocation_id)
    if zone_id:
        query = query.where(DutyAssignment.zone_id == zone_id)
    elif sector_id:
        # A sector's officers are those posted to the sector itself plus
        # everyone in its zones — a commander clicking a sector expects the
        # whole sector, not just their own headquarters row.
        zone_ids = [
            z for (z,) in (
                await db.execute(select(Zone.id).where(Zone.sector_id == sector_id))
            ).all()
        ]
        query = query.where(
            (DutyAssignment.sector_id == sector_id) | (DutyAssignment.zone_id.in_(zone_ids))
        )
    if shift:
        query = query.where(DutyAssignment.shift == shift.upper())

    assignments = (await db.execute(query.order_by(DutyAssignment.work_station))).scalars().all()
    if on_date:
        assignments = [a for a in assignments if _assignment_applies_on(a, on_date)]
    return [_assignment_to_response(a) for a in assignments]


@router.post(
    "/allocations/{allocation_id}/assignments",
    response_model=DutyAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_assignment(
    allocation_id: str,
    payload: DutyAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    alloc = (await db.execute(select(DutyAllocation).where(DutyAllocation.id == allocation_id))).scalars().first()
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation not found.")
    if alloc.status == "ARCHIVED":
        raise HTTPException(status_code=400, detail="This allocation is archived and cannot be edited.")

    officer = (await db.execute(select(User).where(User.id == payload.officer_id))).scalars().first()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found.")
    if officer.role not in ENFORCEMENT_ROLES:
        raise HTTPException(status_code=400, detail="Only enforcement officers can be posted to duty.")

    if payload.shift.upper() not in SHIFTS:
        raise HTTPException(status_code=400, detail=f"shift must be one of {sorted(SHIFTS)}.")
    if payload.coverage.upper() not in COVERAGES:
        raise HTTPException(status_code=400, detail=f"coverage must be one of {sorted(COVERAGES)}.")

    zone = None
    if payload.zone_id:
        zone = (await db.execute(select(Zone).where(Zone.id == payload.zone_id))).scalars().first()
        if not zone:
            raise HTTPException(status_code=404, detail="Zone not found.")
    sector_id = payload.sector_id
    if payload.sector_id:
        sector = (await db.execute(select(Sector).where(Sector.id == payload.sector_id))).scalars().first()
        if not sector:
            raise HTTPException(status_code=404, detail="Sector not found.")
    elif zone is not None:
        # Denormalize the zone's sector onto the posting so sector-level
        # queries and the printed sheet agree without a join every time.
        sector_id = zone.sector_id

    if payload.effective_from and payload.effective_to and payload.effective_to < payload.effective_from:
        raise HTTPException(status_code=400, detail="effective_to cannot be before effective_from.")

    # One officer, one posting per shift+coverage in a given month. Two
    # postings on the same shift is a mistake on a paper sheet too — it
    # means someone is expected in two places at once.
    clash = (
        await db.execute(
            select(DutyAssignment).where(
                DutyAssignment.allocation_id == allocation_id,
                DutyAssignment.officer_id == payload.officer_id,
                DutyAssignment.shift == payload.shift.upper(),
                DutyAssignment.coverage == payload.coverage.upper(),
            )
        )
    ).scalars().first()
    if clash:
        raise HTTPException(
            status_code=400,
            detail=f"{officer.name} already has a {payload.shift.upper()} posting ({clash.work_station}) in this allocation.",
        )

    assignment = DutyAssignment(
        id=f"da-{secrets.token_hex(5)}",
        allocation_id=allocation_id,
        officer_id=payload.officer_id,
        sector_id=sector_id,
        zone_id=payload.zone_id or None,
        work_station=payload.work_station.strip(),
        shift=payload.shift.upper(),
        coverage=payload.coverage.upper(),
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        posting_role=payload.posting_role,
        notes=payload.notes,
        created_at=_now(),
    )
    db.add(assignment)
    stage_audit_log(
        db, resource_type="duty_assignment", resource_id=assignment.id, action="CREATE",
        user_id=current_user.id,
        new_values={"officerId": officer.id, "workStation": assignment.work_station, "shift": assignment.shift},
    )
    await db.commit()

    # Only tell the officer if the sheet is already live. While it is a
    # draft the commander is still moving people around, and a notification
    # per drag would be noise that trains people to ignore the real one.
    if alloc.status == "PUBLISHED":
        await notify_user(
            officer.id,
            title="New duty posting",
            message=f"You have been posted to {assignment.work_station} ({assignment.shift.title()} shift).",
            level="info",
        )

    refreshed = (await db.execute(_assignment_query().where(DutyAssignment.id == assignment.id))).scalars().first()
    return _assignment_to_response(refreshed)


@router.patch("/assignments/{assignment_id}", response_model=DutyAssignmentResponse)
async def update_assignment(
    assignment_id: str,
    payload: DutyAssignmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    assignment = (await db.execute(_assignment_query().where(DutyAssignment.id == assignment_id))).scalars().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Posting not found.")

    alloc = (
        await db.execute(select(DutyAllocation).where(DutyAllocation.id == assignment.allocation_id))
    ).scalars().first()
    if alloc and alloc.status == "ARCHIVED":
        raise HTTPException(status_code=400, detail="This allocation is archived and cannot be edited.")

    old = {"workStation": assignment.work_station, "shift": assignment.shift, "zoneId": assignment.zone_id}

    if payload.shift is not None:
        if payload.shift.upper() not in SHIFTS:
            raise HTTPException(status_code=400, detail=f"shift must be one of {sorted(SHIFTS)}.")
        assignment.shift = payload.shift.upper()
    if payload.coverage is not None:
        if payload.coverage.upper() not in COVERAGES:
            raise HTTPException(status_code=400, detail=f"coverage must be one of {sorted(COVERAGES)}.")
        assignment.coverage = payload.coverage.upper()
    if payload.work_station is not None:
        assignment.work_station = payload.work_station.strip()
    if payload.zone_id is not None:
        assignment.zone_id = payload.zone_id or None
        if assignment.zone_id:
            zone = (await db.execute(select(Zone).where(Zone.id == assignment.zone_id))).scalars().first()
            if not zone:
                raise HTTPException(status_code=404, detail="Zone not found.")
            assignment.sector_id = zone.sector_id
    if payload.sector_id is not None:
        assignment.sector_id = payload.sector_id or None
    if payload.effective_from is not None:
        assignment.effective_from = payload.effective_from
    if payload.effective_to is not None:
        assignment.effective_to = payload.effective_to
    if payload.posting_role is not None:
        assignment.posting_role = payload.posting_role or None
    if payload.notes is not None:
        assignment.notes = payload.notes or None

    if assignment.effective_from and assignment.effective_to and assignment.effective_to < assignment.effective_from:
        raise HTTPException(status_code=400, detail="effective_to cannot be before effective_from.")

    stage_audit_log(
        db, resource_type="duty_assignment", resource_id=assignment.id, action="UPDATE",
        user_id=current_user.id, old_values=old,
        new_values={"workStation": assignment.work_station, "shift": assignment.shift, "zoneId": assignment.zone_id},
    )
    await db.commit()

    if alloc and alloc.status == "PUBLISHED":
        await notify_user(
            assignment.officer_id,
            title="Duty posting changed",
            message=f"Your posting is now {assignment.work_station} ({assignment.shift.title()} shift).",
            level="info",
        )

    refreshed = (await db.execute(_assignment_query().where(DutyAssignment.id == assignment_id))).scalars().first()
    return _assignment_to_response(refreshed)


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    assignment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    assignment = (
        await db.execute(select(DutyAssignment).where(DutyAssignment.id == assignment_id))
    ).scalars().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Posting not found.")

    stage_audit_log(
        db, resource_type="duty_assignment", resource_id=assignment.id, action="DELETE",
        user_id=current_user.id,
        old_values={"officerId": assignment.officer_id, "workStation": assignment.work_station},
    )
    await db.delete(assignment)
    await db.commit()
    return None


# --------------------------------------------------------------------------
# Calendar
# --------------------------------------------------------------------------

@router.get("/calendar", response_model=DutyCalendarResponse)
async def duty_calendar(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("view_users")),
):
    """Per-day posting counts for a month grid. Computed from the month's
    allocation by resolving each posting's coverage against each date —
    there is no per-day row to count, and inventing 4,600 of them just to
    render a calendar would be the tail wagging the dog."""
    alloc = (
        await db.execute(
            select(DutyAllocation).where(DutyAllocation.year == year, DutyAllocation.month == month)
        )
    ).scalars().first()

    assignments = []
    if alloc:
        assignments = (
            await db.execute(select(DutyAssignment).where(DutyAssignment.allocation_id == alloc.id))
        ).scalars().all()

    days: List[DutyCalendarDay] = []
    day_count = calendar.monthrange(year, month)[1]
    for day_num in range(1, day_count + 1):
        day = datetime.date(year, month, day_num)
        applicable = [a for a in assignments if _assignment_applies_on(a, day)]
        days.append(
            DutyCalendarDay(
                date=day,
                is_weekend=day.weekday() >= 5,
                assignment_count=len(applicable),
                shifts=sorted({a.shift for a in applicable}),
            )
        )

    return DutyCalendarResponse(
        year=year,
        month=month,
        allocation_id=alloc.id if alloc else None,
        allocation_status=alloc.status if alloc else None,
        days=days,
    )


# --------------------------------------------------------------------------
# Officer roster and duty status
# --------------------------------------------------------------------------

@router.get("/officers", response_model=List[OfficerRosterResponse])
async def list_officers(
    allocation_id: Optional[str] = Query(None),
    sector_id: Optional[str] = Query(None),
    zone_id: Optional[str] = Query(None),
    duty_status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("view_users")),
):
    """The roster. With an allocation_id, each officer carries where they
    are posted in it; without one, it is the plain establishment list."""
    query = select(User).where(User.role.in_(ENFORCEMENT_ROLES))
    if duty_status:
        query = query.where(User.duty_status == duty_status.upper())
    officers = (await db.execute(query.order_by(User.name))).scalars().all()

    postings: dict = {}
    if allocation_id:
        assignment_query = _assignment_query().where(DutyAssignment.allocation_id == allocation_id)
        if zone_id:
            assignment_query = assignment_query.where(DutyAssignment.zone_id == zone_id)
        elif sector_id:
            assignment_query = assignment_query.where(DutyAssignment.sector_id == sector_id)
        for a in (await db.execute(assignment_query)).scalars().all():
            # First posting wins for the summary column; an officer with a
            # DAILY and a separate WEEKEND row is shown by their daily one,
            # and the full picture is one drill-down away.
            postings.setdefault(a.officer_id, a)

        if sector_id or zone_id:
            officers = [o for o in officers if o.id in postings]

    out: List[OfficerRosterResponse] = []
    for o in officers:
        a = postings.get(o.id)
        out.append(
            OfficerRosterResponse(
                id=o.id,
                name=o.name,
                email=o.email,
                phone=o.phone,
                role=o.role,
                manpower_no=o.manpower_no,
                rank=o.rank,
                gender=o.gender,
                duty_status=o.duty_status or "ON_DUTY",
                duty_status_from=o.duty_status_from,
                duty_status_until=o.duty_status_until,
                duty_status_note=o.duty_status_note,
                enforcement_duty=o.enforcement_duty,
                commander_title=o.commander_title,
                is_active=o.is_active,
                assignment_id=a.id if a else None,
                sector_id=a.sector_id if a else None,
                sector_code=a.sector.code if a and a.sector else None,
                zone_id=a.zone_id if a else None,
                zone_name=a.zone.name if a and a.zone else None,
                work_station=a.work_station if a else None,
                shift=a.shift if a else None,
                coverage=a.coverage if a else None,
                posting_role=a.posting_role if a else None,
            )
        )
    return out


@router.patch("/officers/{officer_id}/status", response_model=OfficerRosterResponse)
async def set_officer_duty_status(
    officer_id: str,
    payload: OfficerDutyStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    officer = (await db.execute(select(User).where(User.id == officer_id))).scalars().first()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found.")

    new_status = payload.duty_status.upper()
    if new_status not in DUTY_STATUSES:
        raise HTTPException(status_code=400, detail=f"duty_status must be one of {sorted(DUTY_STATUSES)}.")
    if payload.duty_status_from and payload.duty_status_until and payload.duty_status_until < payload.duty_status_from:
        raise HTTPException(status_code=400, detail="duty_status_until cannot be before duty_status_from.")

    old = {"dutyStatus": officer.duty_status}
    officer.duty_status = new_status
    # Dates only mean anything for a non-ON_DUTY status; clearing them on
    # the way back to ON_DUTY stops a stale "until the 14th" hanging around
    # after someone returns early.
    officer.duty_status_from = payload.duty_status_from if new_status != "ON_DUTY" else None
    officer.duty_status_until = payload.duty_status_until if new_status != "ON_DUTY" else None
    officer.duty_status_note = (payload.duty_status_note or None) if new_status != "ON_DUTY" else None

    stage_audit_log(
        db, resource_type="officer_duty_status", resource_id=officer.id, action="UPDATE",
        user_id=current_user.id, old_values=old,
        new_values={"dutyStatus": new_status, "from": str(officer.duty_status_from or ""),
                    "until": str(officer.duty_status_until or "")},
    )
    await db.commit()
    await db.refresh(officer)

    await notify_user(
        officer.id,
        title="Duty status updated",
        message=f"Your duty status is now {new_status.replace('_', ' ').title()}.",
        level="info",
    )

    return OfficerRosterResponse(
        id=officer.id, name=officer.name, email=officer.email, phone=officer.phone, role=officer.role,
        manpower_no=officer.manpower_no, rank=officer.rank, gender=officer.gender,
        duty_status=officer.duty_status, duty_status_from=officer.duty_status_from,
        duty_status_until=officer.duty_status_until, duty_status_note=officer.duty_status_note,
        enforcement_duty=officer.enforcement_duty, commander_title=officer.commander_title,
        is_active=officer.is_active,
    )


@router.patch("/officers/{officer_id}/service", response_model=OfficerRosterResponse)
async def set_officer_service_record(
    officer_id: str,
    payload: OfficerServiceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("manage_duty_allocation")),
):
    """MAN. NO / RANK / GENDER — the identifying columns of the sheet."""
    officer = (await db.execute(select(User).where(User.id == officer_id))).scalars().first()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found.")

    if payload.manpower_no:
        clash = (
            await db.execute(
                select(User).where(User.manpower_no == payload.manpower_no.strip(), User.id != officer_id)
            )
        ).scalars().first()
        if clash:
            raise HTTPException(
                status_code=400,
                detail=f"Manpower number {payload.manpower_no} already belongs to {clash.name}.",
            )
    if payload.gender and payload.gender.upper() not in ("M", "F"):
        raise HTTPException(status_code=400, detail="gender must be M, F, or empty.")

    old = {"manpowerNo": officer.manpower_no, "rank": officer.rank}
    if payload.manpower_no is not None:
        officer.manpower_no = payload.manpower_no.strip() or None
    if payload.rank is not None:
        officer.rank = payload.rank.strip() or None
    if payload.gender is not None:
        officer.gender = payload.gender.upper() or None

    stage_audit_log(
        db, resource_type="officer_service_record", resource_id=officer.id, action="UPDATE",
        user_id=current_user.id, old_values=old,
        new_values={"manpowerNo": officer.manpower_no, "rank": officer.rank, "gender": officer.gender},
    )
    await db.commit()
    await db.refresh(officer)

    return OfficerRosterResponse(
        id=officer.id, name=officer.name, email=officer.email, phone=officer.phone, role=officer.role,
        manpower_no=officer.manpower_no, rank=officer.rank, gender=officer.gender,
        duty_status=officer.duty_status or "ON_DUTY", duty_status_from=officer.duty_status_from,
        duty_status_until=officer.duty_status_until, duty_status_note=officer.duty_status_note,
        enforcement_duty=officer.enforcement_duty, commander_title=officer.commander_title,
        is_active=officer.is_active,
    )


# --------------------------------------------------------------------------
# Officer self-service
# --------------------------------------------------------------------------

@router.get("/my-duty", response_model=MyDutyResponse)
async def my_duty(
    on_date: Optional[datetime.date] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """"Once you are allocated work you will see the allocation on your
    end" — this is that endpoint, and it is deliberately the simplest one
    here: today's posting first, the month behind it.

    Only PUBLISHED allocations are visible. A draft is the commander
    thinking out loud; an officer acting on it would be acting on orders
    that were never issued.
    """
    if current_user.role not in ENFORCEMENT_ROLES:
        raise HTTPException(status_code=403, detail="Only enforcement officers have a duty allocation.")

    day = on_date or datetime.datetime.now(datetime.timezone.utc).date()

    alloc = (
        await db.execute(
            select(DutyAllocation).where(
                DutyAllocation.year == day.year,
                DutyAllocation.month == day.month,
                DutyAllocation.status == "PUBLISHED",
            )
        )
    ).scalars().first()

    month_assignments: List[DutyAssignment] = []
    if alloc:
        month_assignments = (
            await db.execute(
                _assignment_query().where(
                    DutyAssignment.allocation_id == alloc.id,
                    DutyAssignment.officer_id == current_user.id,
                )
            )
        ).scalars().all()

    today_assignments = [a for a in month_assignments if _assignment_applies_on(a, day)]

    unread = (
        await db.execute(
            select(func.count(BroadcastRecipient.id)).where(
                BroadcastRecipient.officer_id == current_user.id,
                BroadcastRecipient.read_at.is_(None),
            )
        )
    ).scalar() or 0

    # On duty today means both: posted to something, and not away. An
    # officer on leave who still has a standing monthly posting is not on
    # duty, and showing them a posting without that caveat is how someone
    # gets marked absent for a leave day that was approved.
    status_ok = (current_user.duty_status or "ON_DUTY") == "ON_DUTY"

    return MyDutyResponse(
        date=day,
        on_duty_today=bool(today_assignments) and status_ok,
        duty_status=current_user.duty_status or "ON_DUTY",
        duty_status_until=current_user.duty_status_until,
        duty_status_note=current_user.duty_status_note,
        allocation_month=f"{MONTH_NAMES[alloc.month]} {alloc.year}" if alloc else None,
        allocation_reference=alloc.reference_no if alloc else None,
        today=[_assignment_to_response(a) for a in today_assignments],
        month=[_assignment_to_response(a) for a in month_assignments],
        unread_broadcasts=unread,
    )
