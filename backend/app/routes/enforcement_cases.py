import datetime
import json
import random
import string
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import EnforcementCase, OffenceType, Zone, User, Matatu
from app.schemas import (
    ZoneResponse,
    OffenceTypeResponse,
    OfficerAssignmentUpdate,
    OfficerAssignmentResponse,
    EnforcementCaseResponse,
    EnforcementCaseDecision,
    PublicCaseResponse,
    PublicDisputeCreate,
    CaseAssignReviewer,
    CaseNoteCreate,
    CaseResolve,
)
from app.auth import get_current_user, requires_permission
from app.events import dispatcher
from app.audit import stage_audit_log
from app.routes.notifications import notify_user
from app.sms import send_sms
from app.config import PUBLIC_FRONTEND_URL
from app.storage import save_upload

router = APIRouter(prefix="/api/enforcement", tags=["Enforcement Cases"])

VALID_ACTIONS = ["IMPOUND", "SELF_DRIVE_IMPOUND", "TOLL"]
VALID_DUTIES = ["ARRESTING", "RELEASING", None]


def _generate_case_reference(reg_number: str) -> str:
    reg_clean = "".join(ch for ch in reg_number.upper() if ch.isalnum())
    digits = "".join(random.choices(string.digits, k=5))
    letter = random.choice(string.ascii_uppercase)
    return f"MMS-{digits}{reg_clean}{letter}"


async def _to_case_response(db: AsyncSession, case: EnforcementCase) -> EnforcementCase:
    if case.offence_type and not getattr(case, "offence_name", None):
        case.offence_name = case.offence_type.name
    if case.zone and not getattr(case, "zone_name", None):
        case.zone_name = case.zone.name
    if case.arresting_officer:
        case.arresting_officer_name = case.arresting_officer.name
    if case.releasing_officer:
        case.releasing_officer_name = case.releasing_officer.name
    if case.reviewer:
        case.reviewer_name = case.reviewer.name
    if case.resolved_by:
        case.resolved_by_name = case.resolved_by.name
    try:
        case.photo_paths = json.loads(case.photo_paths) if isinstance(case.photo_paths, str) else (case.photo_paths or [])
    except (TypeError, ValueError):
        case.photo_paths = []
    try:
        case.review_notes = json.loads(case.review_notes) if isinstance(case.review_notes, str) else (case.review_notes or [])
    except (TypeError, ValueError):
        case.review_notes = []
    return case


def _case_query():
    return select(EnforcementCase).options(
        selectinload(EnforcementCase.offence_type),
        selectinload(EnforcementCase.zone),
        selectinload(EnforcementCase.arresting_officer),
        selectinload(EnforcementCase.releasing_officer),
        selectinload(EnforcementCase.reviewer),
        selectinload(EnforcementCase.resolved_by),
    )


# --- Reference data ---

@router.get("/zones", response_model=List[ZoneResponse])
async def get_zones(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Zone))
    return result.scalars().all()


@router.get("/offence-types", response_model=List[OffenceTypeResponse])
async def get_offence_types(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(OffenceType))
    return result.scalars().all()


# --- Officer duty & zone assignment (Commander / Admin) ---

@router.get("/officer-assignments", response_model=List[OfficerAssignmentResponse])
async def get_officer_assignments(
    current_user: User = Depends(requires_permission("manage_officer_assignments")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.role.in_(["ARRESTING_OFFICER", "RELEASING_OFFICER", "ENFORCEMENT_COMMANDER", "ENFORCEMENT"]))
    )
    return result.scalars().all()


@router.patch("/officer-assignments/{user_id}", response_model=OfficerAssignmentResponse)
async def update_officer_assignment(
    user_id: str,
    payload: OfficerAssignmentUpdate,
    current_user: User = Depends(requires_permission("manage_officer_assignments")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    officer = result.scalars().first()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")

    if payload.enforcement_duty is not None and payload.enforcement_duty not in ("ARRESTING", "RELEASING", ""):
        raise HTTPException(status_code=400, detail="enforcementDuty must be ARRESTING, RELEASING, or empty to clear.")

    if payload.enforcement_duty is not None:
        officer.enforcement_duty = payload.enforcement_duty or None
    if payload.assigned_zone_id is not None:
        officer.assigned_zone_id = payload.assigned_zone_id or None
    if payload.commander_title is not None:
        officer.commander_title = payload.commander_title or None

    stage_audit_log(
        db, resource_type="officer_assignment", resource_id=user_id, action="ASSIGNMENT_UPDATED",
        user_id=current_user.id,
        new_values={"duty": officer.enforcement_duty, "zoneId": officer.assigned_zone_id, "commanderTitle": officer.commander_title},
    )
    await db.commit()
    await db.refresh(officer)

    dispatcher.dispatch("OFFICER_ASSIGNMENT_UPDATED", {
        "officer_id": officer.id, "duty": officer.enforcement_duty,
        "zone_id": officer.assigned_zone_id, "assigned_by": current_user.id,
    })
    return officer


# --- Enforcement cases: file (arrest) -> release/dispute/waive ---

@router.get("/cases", response_model=List[EnforcementCaseResponse])
async def get_cases(
    current_user: User = Depends(requires_permission("view_enforcement_cases")),
    db: AsyncSession = Depends(get_db),
):
    query = _case_query().order_by(EnforcementCase.created_at.desc())
    # Arresting officers see only cases they personally filed; releasing officers,
    # commanders and admin see the full queue (they need visibility across officers).
    if current_user.role == "ARRESTING_OFFICER":
        query = query.where(EnforcementCase.arresting_officer_id == current_user.id)
    elif current_user.role == "SACCO_OPERATOR":
        # Scoped to their own fleet only — a case's reg_number isn't a
        # direct FK (it's a plain string, matching Matatu.reg_number), so
        # this is a subquery against the operator's own vehicles rather
        # than a join.
        fleet_result = await db.execute(select(Matatu.reg_number).where(Matatu.sacco_id == current_user.sacco_id))
        fleet_reg_numbers = fleet_result.scalars().all()
        query = query.where(EnforcementCase.reg_number.in_(fleet_reg_numbers))

    result = await db.execute(query)
    cases = result.scalars().all()
    for c in cases:
        await _to_case_response(db, c)
    return cases


@router.get("/cases/public/lookup-by-phone", response_model=PublicCaseResponse)
async def public_lookup_case_by_phone(phone: str, db: AsyncSession = Depends(get_db)):
    """
    Registered before the /{case_reference} route below — FastAPI matches
    path routes in registration order, and without this ordering
    "lookup-by-phone" would itself be swallowed as a literal case_reference
    value by that route instead of reaching this one.

    Finds the vehicle(s) where this phone is on file as driver or
    conductor (Matatu.driver_phone / conductor_phone — the same free-text
    fields already shown on the vehicle record, not a new source of
    truth), then returns that vehicle's single most recent case. A driver
    who only remembers their own phone number, not a case reference they
    were handed on paper, can still look themselves up.
    """
    normalized = phone.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Enter a phone number.")

    matatu_result = await db.execute(
        select(Matatu.reg_number).where(
            (Matatu.driver_phone == normalized) | (Matatu.conductor_phone == normalized)
        )
    )
    reg_numbers = matatu_result.scalars().all()
    if not reg_numbers:
        raise HTTPException(status_code=404, detail="No cases found for that phone number.")

    result = await db.execute(
        _case_query()
        .where(EnforcementCase.reg_number.in_(reg_numbers))
        .order_by(EnforcementCase.created_at.desc())
        .limit(1)
    )
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="No cases found for that phone number.")
    await _to_case_response(db, case)
    return case


@router.get("/cases/public/{case_reference}", response_model=PublicCaseResponse)
async def public_lookup_case(case_reference: str, db: AsyncSession = Depends(get_db)):
    """Unauthenticated lookup so an offender can find and pay their fine without registering."""
    result = await db.execute(
        _case_query().where(EnforcementCase.case_reference == case_reference.strip().upper())
    )
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="No case found with that reference number.")
    await _to_case_response(db, case)
    return case


@router.post("/cases/public/{case_reference}/pay", response_model=PublicCaseResponse)
async def public_pay_case(case_reference: str, db: AsyncSession = Depends(get_db)):
    """
    Stub payment — NairobiPay integration is pending (no API key yet), matching
    the same "records now, real gateway later" pattern used for Sacco license
    renewals. Marks the case PAID so the Releasing Officer can finalize release.
    """
    result = await db.execute(
        _case_query().where(EnforcementCase.case_reference == case_reference.strip().upper())
    )
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="No case found with that reference number.")
    # RESOLVED_UPHELD is payable too — a dispute review that upholds the
    # original fine puts it right back on the hook for it, not a dead end.
    if case.status not in ("ARRESTED", "RESOLVED_UPHELD"):
        raise HTTPException(status_code=400, detail=f"This case is already {case.status.lower()} and cannot be paid again.")

    case.status = "PAID"
    case.payment_reference = f"PAY-{uuid.uuid4().hex[:10].upper()}"
    case.paid_at = datetime.datetime.now(datetime.timezone.utc)
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case.id, action="FINE_PAID",
        user_id="PUBLIC_PAYER", new_values={"paymentReference": case.payment_reference, "caseReference": case.case_reference},
    )
    await db.commit()
    await db.refresh(case)
    await _to_case_response(db, case)

    await notify_user(
        case.arresting_officer_id,
        title="Fine paid",
        message=f"{case.arresting_officer.name}, the fine for case {case.case_reference} ({case.reg_number}) has been paid and is ready for release.",
        level="success",
    )

    dispatcher.dispatch("ENFORCEMENT_FINE_PAID", {
        "case_id": case.id, "case_reference": case.case_reference, "payment_reference": case.payment_reference,
    })
    return case


@router.post("/cases", response_model=EnforcementCaseResponse)
async def create_case(
    reg_number: str = Form(...),
    offence_type_id: str = Form(...),
    offence_description: Optional[str] = Form(None),
    action_taken: str = Form(...),
    photos: List[UploadFile] = File(default=[]),
    current_user: User = Depends(requires_permission("file_enforcement_case")),
    db: AsyncSession = Depends(get_db),
):
    """
    Arresting Officer scene report. The fine amount is never entered by the
    officer — it's locked from the selected OffenceType's county-set
    default_fine_kes, so citations stay consistent regardless of who's on
    duty.
    """
    action_taken = action_taken.upper().strip()
    if action_taken not in VALID_ACTIONS:
        raise HTTPException(status_code=400, detail=f"actionTaken must be one of {VALID_ACTIONS}")

    valid_photos = [p for p in (photos or []) if p.filename]
    if not valid_photos:
        raise HTTPException(status_code=400, detail="At least one scene photo is required to file a case.")

    offence_result = await db.execute(select(OffenceType).where(OffenceType.id == offence_type_id))
    offence = offence_result.scalars().first()
    if not offence:
        raise HTTPException(status_code=400, detail="Invalid offence type.")
    if offence.is_other and not (offence_description or "").strip():
        raise HTTPException(status_code=400, detail="A description is required when the offence is 'Other'.")

    reg_clean = reg_number.upper().strip()
    case_id = f"case-{uuid.uuid4().hex[:10]}"
    case_reference = _generate_case_reference(reg_clean)

    photo_paths = []
    for photo in valid_photos:
        contents = await photo.read()
        photo_paths.append(await save_upload("enforcement_cases", case_id, photo.filename, contents, db=db))

    zone_id = current_user.assigned_zone_id if current_user.role == "ARRESTING_OFFICER" else None

    new_case = EnforcementCase(
        id=case_id,
        case_reference=case_reference,
        reg_number=reg_clean,
        offence_type_id=offence.id,
        offence_description=offence_description,
        fine_amount_kes=offence.default_fine_kes,
        action_taken=action_taken,
        photo_paths=json.dumps(photo_paths),
        zone_id=zone_id,
        arresting_officer_id=current_user.id,
        created_at=datetime.datetime.now(datetime.timezone.utc),
        status="ARRESTED",
    )
    db.add(new_case)
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case_id, action="CASE_FILED",
        user_id=current_user.id,
        new_values={"caseReference": case_reference, "regNumber": reg_clean, "offence": offence.name, "fineAmountKes": offence.default_fine_kes, "actionTaken": action_taken},
    )

    # Fetched unconditionally (not just for impound actions) — the driver/
    # conductor SMS and Sacco-operator notification below need it
    # regardless of action_taken; a Toll still cites a real driver.
    matatu_result = await db.execute(select(Matatu).where(Matatu.reg_number == reg_clean))
    matatu = matatu_result.scalars().first()

    # A Toll leaves the vehicle free to continue operating — only an actual
    # impound (with or without a self-drive release) takes it off the road.
    if action_taken in ("IMPOUND", "SELF_DRIVE_IMPOUND") and matatu and matatu.status == "ACTIVE":
        matatu.status = "FLAGGED"

    await db.commit()

    pay_link = f"{PUBLIC_FRONTEND_URL}/pay-fine?ref={case_reference}"
    sms_message = (
        f"Nairobi County: your vehicle {reg_clean} was cited for {offence.name} "
        f"(case {case_reference}, fine KES {offence.default_fine_kes:,.0f}). "
        f"Pay or check status: {pay_link}"
    )
    # Driver and conductor are both plain free-text fields on Matatu, not
    # guaranteed distinct people — send once per unique number so a vehicle
    # with the same phone in both fields doesn't get texted twice.
    #
    # Deliberately done here, before the _case_query()/_to_case_response()
    # re-fetch below — that helper mutates case.photo_paths from its raw
    # JSON string into a Python list on the still-session-attached ORM
    # object, which SQLite can't bind if anything triggers an autoflush
    # afterward (the operator lookup below is exactly such a query). Doing
    # the DB-touching notification work first, while the case object is
    # still clean, sidesteps that rather than fighting autoflush ordering.
    if matatu:
        recipients = {p for p in (matatu.driver_phone, matatu.conductor_phone) if p}
        for phone in recipients:
            await send_sms(phone, sms_message)

        # Best-effort in-app nudge to the Sacco's own operator(s) — same
        # pattern as the "fine paid" notification to the arresting officer
        # below in public_pay_case(). Not the only way an operator finds
        # out: they also see this case in their own scoped case list
        # (get_cases() above) next time they open the portal, so a missed
        # toast isn't a missed notification, just a slower one.
        if matatu.sacco_id:
            operators_result = await db.execute(
                select(User).where(User.role == "SACCO_OPERATOR", User.sacco_id == matatu.sacco_id)
            )
            for operator in operators_result.scalars().all():
                await notify_user(
                    operator.id,
                    title="Vehicle cited",
                    message=f"{reg_clean} was cited for {offence.name} (case {case_reference}, fine KES {offence.default_fine_kes:,.0f}).",
                    level="warning",
                )

    result = await db.execute(_case_query().where(EnforcementCase.id == case_id))
    case = result.scalars().first()
    await _to_case_response(db, case)

    dispatcher.dispatch("ENFORCEMENT_CASE_FILED", {
        "case_id": case.id, "case_reference": case.case_reference, "reg_number": reg_clean,
        "officer_id": current_user.id, "fine_amount_kes": offence.default_fine_kes,
    })
    return case


@router.patch("/cases/{case_id}/release", response_model=EnforcementCaseResponse)
async def release_case(
    case_id: str,
    current_user: User = Depends(requires_permission("decide_enforcement_case")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(_case_query().where(EnforcementCase.id == case_id))
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if case.status != "PAID":
        raise HTTPException(status_code=400, detail="This case cannot be released until the fine is paid.")

    case.status = "RELEASED"
    case.releasing_officer_id = current_user.id
    case.released_at = datetime.datetime.now(datetime.timezone.utc)
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case.id, action="CASE_RELEASED",
        user_id=current_user.id, new_values={"caseReference": case.case_reference},
    )
    await db.commit()
    await db.refresh(case)
    await _to_case_response(db, case)

    dispatcher.dispatch("ENFORCEMENT_CASE_RELEASED", {
        "case_id": case.id, "case_reference": case.case_reference, "releasing_officer_id": current_user.id,
    })
    return case


@router.patch("/cases/{case_id}/dispute", response_model=EnforcementCaseResponse)
async def dispute_case(
    case_id: str,
    payload: EnforcementCaseDecision,
    current_user: User = Depends(requires_permission("decide_enforcement_case")),
    db: AsyncSession = Depends(get_db),
):
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required to mark a case disputed.")

    result = await db.execute(_case_query().where(EnforcementCase.id == case_id))
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    case.status = "DISPUTED"
    case.dispute_reason = payload.reason
    case.releasing_officer_id = current_user.id
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case.id, action="CASE_DISPUTED",
        user_id=current_user.id, new_values={"caseReference": case.case_reference, "reason": payload.reason},
    )
    await db.commit()
    await db.refresh(case)
    await _to_case_response(db, case)

    dispatcher.dispatch("ENFORCEMENT_CASE_DISPUTED", {
        "case_id": case.id, "case_reference": case.case_reference, "reason": payload.reason, "user_id": current_user.id,
    })
    return case


# --- Dispute review workflow (Task 2 §2: DISPUTED -> UNDER_REVIEW -> RESOLVED_*),
# mirrors the Sacco verification two-stage pattern. dispute_case() above is the
# staff-initiated path (an officer marks a case disputed); public_dispute_case()
# below is the actual missing entry point — the offender raising the dispute
# themselves, unauthenticated, from the pay-fine lookup page.

@router.post("/cases/public/{case_reference}/dispute", response_model=PublicCaseResponse)
async def public_dispute_case(case_reference: str, payload: PublicDisputeCreate, db: AsyncSession = Depends(get_db)):
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Tell us why you're disputing this fine.")

    result = await db.execute(
        _case_query().where(EnforcementCase.case_reference == case_reference.strip().upper())
    )
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="No case found with that reference number.")
    if case.status not in ("ARRESTED", "PAID"):
        raise HTTPException(status_code=400, detail=f"This case is already {case.status.lower()} and can no longer be disputed.")

    case.status = "DISPUTED"
    case.dispute_reason = payload.reason.strip() + (f" (contact: {payload.contact_phone.strip()})" if payload.contact_phone and payload.contact_phone.strip() else "")
    case.disputed_at = datetime.datetime.now(datetime.timezone.utc)
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case.id, action="CASE_DISPUTED",
        user_id="PUBLIC_DISPUTANT", new_values={"caseReference": case.case_reference, "reason": payload.reason},
    )
    await db.commit()
    await db.refresh(case)
    await _to_case_response(db, case)

    dispatcher.dispatch("ENFORCEMENT_CASE_DISPUTED", {
        "case_id": case.id, "case_reference": case.case_reference, "reason": payload.reason, "user_id": "PUBLIC_DISPUTANT",
    })
    await notify_user(
        case.arresting_officer_id,
        title="Fine disputed",
        message=f"The offender has disputed case {case.case_reference} ({case.reg_number}): \"{payload.reason.strip()}\"",
    )
    return case


@router.patch("/cases/{case_id}/assign-reviewer", response_model=EnforcementCaseResponse)
async def assign_case_reviewer(
    case_id: str,
    payload: CaseAssignReviewer,
    current_user: User = Depends(requires_permission("review_case_dispute")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(_case_query().where(EnforcementCase.id == case_id))
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if case.status != "DISPUTED":
        raise HTTPException(status_code=400, detail="Only a disputed case can be picked up for review.")

    reviewer_result = await db.execute(select(User).where(User.id == payload.reviewer_id))
    reviewer = reviewer_result.scalars().first()
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")

    case.status = "UNDER_REVIEW"
    case.reviewer_id = payload.reviewer_id
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case.id, action="CASE_REVIEW_ASSIGNED",
        user_id=current_user.id, new_values={"caseReference": case.case_reference, "reviewerId": payload.reviewer_id},
    )
    await db.commit()
    await db.refresh(case)
    await _to_case_response(db, case)

    dispatcher.dispatch("ENFORCEMENT_CASE_REVIEW_ASSIGNED", {
        "case_id": case.id, "case_reference": case.case_reference, "reviewer_id": payload.reviewer_id, "assigned_by": current_user.id,
    })
    await notify_user(
        payload.reviewer_id,
        title="Case assigned for review",
        message=f"You've been assigned to review disputed case {case.case_reference} ({case.reg_number}).",
    )
    return case


@router.post("/cases/{case_id}/notes", response_model=EnforcementCaseResponse)
async def add_case_note(
    case_id: str,
    payload: CaseNoteCreate,
    current_user: User = Depends(requires_permission("review_case_dispute")),
    db: AsyncSession = Depends(get_db),
):
    if not payload.note.strip():
        raise HTTPException(status_code=400, detail="Note can't be empty.")

    result = await db.execute(_case_query().where(EnforcementCase.id == case_id))
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    try:
        notes = json.loads(case.review_notes) if case.review_notes else []
    except (TypeError, ValueError):
        notes = []
    notes.append({
        "authorId": current_user.id,
        "authorName": current_user.name,
        "note": payload.note.strip(),
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    })
    case.review_notes = json.dumps(notes)
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case.id, action="CASE_NOTE_ADDED",
        user_id=current_user.id, new_values={"caseReference": case.case_reference, "note": payload.note},
    )
    await db.commit()
    await db.refresh(case)
    await _to_case_response(db, case)
    return case


@router.patch("/cases/{case_id}/resolve", response_model=EnforcementCaseResponse)
async def resolve_case_dispute(
    case_id: str,
    payload: CaseResolve,
    current_user: User = Depends(requires_permission("review_case_dispute")),
    db: AsyncSession = Depends(get_db),
):
    if payload.resolution not in ("UPHELD", "OVERTURNED", "PARTIAL"):
        raise HTTPException(status_code=400, detail="resolution must be UPHELD, OVERTURNED, or PARTIAL.")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="A decision reason is required to resolve a dispute.")

    result = await db.execute(_case_query().where(EnforcementCase.id == case_id))
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if case.status != "UNDER_REVIEW":
        raise HTTPException(status_code=400, detail="Only a case under review can be resolved. Assign a reviewer first.")

    case.status = f"RESOLVED_{payload.resolution}"
    case.resolution = payload.resolution
    case.resolution_reason = payload.reason.strip()
    case.resolved_by_id = current_user.id
    case.resolved_at = datetime.datetime.now(datetime.timezone.utc)
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case.id, action="CASE_DISPUTE_RESOLVED",
        user_id=current_user.id,
        new_values={"caseReference": case.case_reference, "resolution": payload.resolution, "reason": payload.reason},
    )
    await db.commit()
    await db.refresh(case)
    await _to_case_response(db, case)

    dispatcher.dispatch("ENFORCEMENT_CASE_DISPUTE_RESOLVED", {
        "case_id": case.id, "case_reference": case.case_reference, "resolution": payload.resolution, "resolved_by": current_user.id,
    })
    await notify_user(
        case.arresting_officer_id,
        title="Dispute resolved",
        message=f"Case {case.case_reference} ({case.reg_number}) dispute was resolved: {payload.resolution.title()} — {payload.reason.strip()}",
    )
    return case


@router.patch("/cases/{case_id}/waive", response_model=EnforcementCaseResponse)
async def waive_case(
    case_id: str,
    payload: EnforcementCaseDecision,
    current_user: User = Depends(requires_permission("decide_enforcement_case")),
    db: AsyncSession = Depends(get_db),
):
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required to waive a case.")
    if not (payload.authorized_by or "").strip():
        raise HTTPException(status_code=400, detail="Waivers must record who authorized them.")

    result = await db.execute(_case_query().where(EnforcementCase.id == case_id))
    case = result.scalars().first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    case.status = "WAIVED"
    case.waived_reason = payload.reason
    case.waived_authorized_by = payload.authorized_by
    case.releasing_officer_id = current_user.id
    case.released_at = datetime.datetime.now(datetime.timezone.utc)
    stage_audit_log(
        db, resource_type="enforcement_case", resource_id=case.id, action="CASE_WAIVED",
        user_id=current_user.id,
        new_values={"caseReference": case.case_reference, "reason": payload.reason, "authorizedBy": payload.authorized_by},
    )
    await db.commit()
    await db.refresh(case)
    await _to_case_response(db, case)

    dispatcher.dispatch("ENFORCEMENT_CASE_WAIVED", {
        "case_id": case.id, "case_reference": case.case_reference,
        "reason": payload.reason, "authorized_by": payload.authorized_by, "user_id": current_user.id,
    })
    return case
