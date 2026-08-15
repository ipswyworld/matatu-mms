"""
Enforcement beat allocation (ARCHITECTURE_DECISIONS.md §22, Task 18). A
beat is a route-segment — an ordered slice of one route's corridor between
two stages (reusing the BRN Stage/RouteStage geometry from Task 8) — not a
freeform polygon, per §22.2's decision. `BeatAssignment` is the time-boxed
officer-to-beat record from §22.3, additive alongside the existing sticky
`User.assigned_zone_id` field (enforcement_cases.py's officer-assignments
endpoints), not a replacement — nothing currently reading that field
breaks.

Live officer position tracking (§22.4) is explicitly out of scope here:
officers have no NTSA-IRMS-style fallback (unlike buses), so continuous
tracking depends entirely on the officer's phone staying foregrounded —
a real product decision (native-app phase vs. a foreground-only "on
patrol" screen) rather than something to build silently into an API
response. What's built here — the assignment/coverage half — is real and
usable without that decision being made.
"""
import datetime
import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Beat, BeatAssignment, Route, Stage, User
from app.schemas import BeatCreate, BeatResponse, BeatAssignmentCreate, BeatAssignmentResponse
from app.auth import requires_permission
from app.audit import stage_audit_log
from app.events import dispatcher

router = APIRouter(prefix="/api/beats", tags=["Enforcement Beats"])

ENFORCEMENT_ROLES = ("ARRESTING_OFFICER", "RELEASING_OFFICER", "ENFORCEMENT_COMMANDER", "ENFORCEMENT")


@router.get("", response_model=List[BeatResponse])
async def list_beats(
    current_user: User = Depends(requires_permission("view_routes")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Beat).order_by(Beat.name))
    return result.scalars().all()


@router.post("", response_model=BeatResponse, status_code=status.HTTP_201_CREATED)
async def create_beat(
    payload: BeatCreate,
    current_user: User = Depends(requires_permission("manage_officer_assignments")),
    db: AsyncSession = Depends(get_db),
):
    route = (await db.execute(select(Route).where(Route.id == payload.route_id))).scalars().first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    for stage_id, label in ((payload.from_stage_id, "from_stage_id"), (payload.to_stage_id, "to_stage_id")):
        if not (await db.execute(select(Stage).where(Stage.id == stage_id))).scalars().first():
            raise HTTPException(status_code=404, detail=f"Stage not found: {label}")

    beat = Beat(
        id=f"beat-{secrets.token_hex(4)}",
        name=payload.name.strip(),
        route_id=payload.route_id,
        from_stage_id=payload.from_stage_id,
        to_stage_id=payload.to_stage_id,
        zone_id=payload.zone_id,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(beat)
    stage_audit_log(
        db, resource_type="beat", resource_id=beat.id, action="CREATE",
        user_id=current_user.id,
        new_values={"name": beat.name, "routeId": beat.route_id},
    )
    await db.commit()
    await db.refresh(beat)
    return beat


def _assignment_to_response(a: BeatAssignment) -> BeatAssignmentResponse:
    return BeatAssignmentResponse(
        id=a.id,
        officer_id=a.officer_id,
        officer_name=a.officer.name,
        beat_id=a.beat_id,
        beat_name=a.beat.name,
        shift_date=a.shift_date,
        shift_start=a.shift_start,
        shift_end=a.shift_end,
        assigned_by=a.assigned_by,
        created_at=a.created_at,
    )


@router.get("/assignments", response_model=List[BeatAssignmentResponse])
async def list_beat_assignments(
    shift_date: datetime.date | None = Query(None, description="Filter to one day's roster; omit for the full history."),
    officer_id: str | None = Query(None),
    current_user: User = Depends(requires_permission("manage_officer_assignments")),
    db: AsyncSession = Depends(get_db),
):
    query = select(BeatAssignment).options(
        selectinload(BeatAssignment.officer), selectinload(BeatAssignment.beat)
    ).order_by(BeatAssignment.shift_date.desc(), BeatAssignment.shift_start.desc())
    if shift_date:
        query = query.where(BeatAssignment.shift_date == shift_date)
    if officer_id:
        query = query.where(BeatAssignment.officer_id == officer_id)
    result = await db.execute(query)
    return [_assignment_to_response(a) for a in result.scalars().all()]


@router.get("/my-assignment", response_model=BeatAssignmentResponse)
async def get_my_current_assignment(
    current_user: User = Depends(requires_permission("view_matatus")),
    db: AsyncSession = Depends(get_db),
):
    """"What is my beat today?" (§22 — the enforcement officer's stated
    question). Returns the assignment covering right now, if any."""
    if current_user.role not in ENFORCEMENT_ROLES:
        raise HTTPException(status_code=403, detail="Only enforcement officers have a beat assignment.")
    now = datetime.datetime.now(datetime.timezone.utc)
    result = await db.execute(
        select(BeatAssignment)
        .options(selectinload(BeatAssignment.officer), selectinload(BeatAssignment.beat))
        .where(
            BeatAssignment.officer_id == current_user.id,
            BeatAssignment.shift_start <= now,
            BeatAssignment.shift_end >= now,
        )
        .order_by(BeatAssignment.shift_start.desc())
    )
    assignment = result.scalars().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="No active beat assignment right now.")
    return _assignment_to_response(assignment)


@router.post("/assignments", response_model=BeatAssignmentResponse, status_code=status.HTTP_201_CREATED)
async def create_beat_assignment(
    payload: BeatAssignmentCreate,
    current_user: User = Depends(requires_permission("manage_officer_assignments")),
    db: AsyncSession = Depends(get_db),
):
    officer = (await db.execute(select(User).where(User.id == payload.officer_id))).scalars().first()
    if not officer or officer.role not in ENFORCEMENT_ROLES:
        raise HTTPException(status_code=400, detail="officer_id must be an enforcement officer account.")
    beat = (await db.execute(select(Beat).where(Beat.id == payload.beat_id))).scalars().first()
    if not beat:
        raise HTTPException(status_code=404, detail="Beat not found")
    if payload.shift_end <= payload.shift_start:
        raise HTTPException(status_code=400, detail="shift_end must be after shift_start")

    assignment = BeatAssignment(
        id=f"ba-{secrets.token_hex(4)}",
        officer_id=payload.officer_id,
        beat_id=payload.beat_id,
        shift_date=payload.shift_date,
        shift_start=payload.shift_start,
        shift_end=payload.shift_end,
        assigned_by=current_user.id,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(assignment)
    stage_audit_log(
        db, resource_type="beat_assignment", resource_id=assignment.id, action="CREATE",
        user_id=current_user.id,
        new_values={
            "officerId": payload.officer_id, "beatId": payload.beat_id,
            "shiftDate": payload.shift_date.isoformat(),
        },
    )
    await db.commit()
    await db.refresh(assignment, attribute_names=["officer", "beat"])

    # Extends the existing OFFICER_ASSIGNMENT_UPDATED event (enforcement_
    # cases.py) with the segment + shift window, per §22.3.
    dispatcher.dispatch("OFFICER_ASSIGNMENT_UPDATED", {
        "officer_id": assignment.officer_id, "beat_id": assignment.beat_id,
        "shift_date": str(assignment.shift_date), "assigned_by": current_user.id,
    })
    return _assignment_to_response(assignment)
