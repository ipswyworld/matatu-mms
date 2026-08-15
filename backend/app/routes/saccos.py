import datetime
import json
import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import Sacco, User
from app.schemas import (
    SaccoResponse,
    SaccoPublicResponse,
    SaccoVerificationUpdate,
    LicenseRenewalDecision,
    OperatorOnboardingRegister,
    SaccoOfficialsUpdate,
    VerificationStageDecision,
    Token,
    UserResponse,
)
from app.auth import get_current_user, requires_permission, get_password_hash, create_access_token
from app.config import TERMS_VERSION
from app.events import dispatcher
from app.audit import stage_audit_log
from app.routes.notifications import notify_user
from app.abac import sacco_scope_query, enforce_own_sacco_operator_only

router = APIRouter(prefix="/api/saccos", tags=["Saccos"])


async def _notify_sacco_operators(db: AsyncSession, sacco_id: str, title: str, message: str, level: str = "info") -> None:
    """Pushes a name-addressed, real-time notification to every operator account tied to this Sacco."""
    result = await db.execute(select(User).where(User.sacco_id == sacco_id, User.role == "SACCO_OPERATOR"))
    for operator in result.scalars().all():
        await notify_user(operator.id, title=title, message=f"{operator.name}, {message}", level=level)

UPLOAD_ROOT = os.path.join(os.getcwd(), "uploads", "saccos")

MANDATORY_DOC_FIELDS = [
    ("doc_registration_cert", "Registration Certificate"),
    ("doc_road_service_license", "Road Service License"),
    ("doc_county_permit", "Permit from County"),
    ("doc_single_business_permit", "Single Business Permit"),
    ("doc_tax_compliance_cert", "Tax Compliance Certificate"),
]


def _missing_mandatory_docs(sacco: Sacco) -> list:
    missing = [label for field, label in MANDATORY_DOC_FIELDS if not getattr(sacco, field)]
    if sacco.sacco_type == "NEW" and not sacco.doc_letter_no_objection:
        missing.append("Letter of No Objection (required for new operators before their Road Service License can be accepted)")
    if not sacco.doc_officials_contacts:
        missing.append("Bonafide Officials Contacts")
    return missing


DOC_FIELD_MAP = {
    "registrationCert": "doc_registration_cert",
    "roadServiceLicense": "doc_road_service_license",
    "countyPermit": "doc_county_permit",
    "singleBusinessPermit": "doc_single_business_permit",
    "taxComplianceCert": "doc_tax_compliance_cert",
    "letterNoObjection": "doc_letter_no_objection",
}


@router.get("", response_model=List[SaccoResponse])
async def get_saccos(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Sacco)
    query = sacco_scope_query(current_user, query, Sacco.id)

    result = await db.execute(query)
    saccos = result.scalars().all()
    return saccos


@router.get("/public", response_model=List[SaccoPublicResponse])
async def get_public_saccos(db: AsyncSession = Depends(get_db)):
    """
    Unauthenticated list of registrable Saccos (id + name only) for pre-login
    flows like the public registration page, which can't call the authed
    GET /api/saccos endpoint above since the user has no session yet.

    Includes PENDING_VERIFICATION Saccos, not just ACTIVE ones — a newly
    onboarded Sacco still needs to be pickable so its Crew can sign up while
    the operator's own verification is in progress. Only REJECTED/SUSPENDED
    Saccos are excluded.
    """
    query = select(Sacco).where(Sacco.status.notin_(["REJECTED", "SUSPENDED"]))
    result = await db.execute(query)
    saccos = result.scalars().all()
    return saccos


@router.post("/onboard", response_model=Token)
async def onboard_operator(
    payload: OperatorOnboardingRegister,
    db: AsyncSession = Depends(get_db),
):
    """
    Self-service Sacco/Operator onboarding entry point. Creates a brand new
    Sacco record in PENDING verification (both Director of Mobility and
    Chief Officer stages start PENDING) plus the first SACCO_OPERATOR
    account for it, using the password the applicant sets right here. The
    operator can log in immediately afterwards to upload documents and track
    status, but the full operator dashboard stays locked until both
    verification stages are APPROVED.
    """
    if payload.sacco_type not in ("NEW", "EXISTING"):
        raise HTTPException(status_code=400, detail="saccoType must be NEW or EXISTING.")

    if not payload.terms_accepted:
        raise HTTPException(status_code=400, detail="You must agree to the Terms & Conditions to register.")
    signature = (payload.terms_signature or "").strip()
    if not signature:
        raise HTTPException(status_code=400, detail="You must type your name to sign the Terms & Conditions.")
    if signature.lower() != payload.name.strip().lower():
        raise HTTPException(status_code=400, detail="Your signature must match the full name entered above.")

    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="User email already registered")

    sacco_id = f"sacco-{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now(datetime.timezone.utc)

    sacco = Sacco(
        id=sacco_id,
        name=payload.sacco_name,
        status="PENDING_VERIFICATION",
        license_status="ACTIVE",
        sacco_type=payload.sacco_type,
        created_at=now_iso,
        director_mobility_status="PENDING",
        chief_officer_status="PENDING",
    )
    db.add(sacco)

    user_id = f"u-{uuid.uuid4().hex[:8]}"
    user = User(
        id=user_id,
        name=payload.name,
        email=payload.email,
        password=get_password_hash(payload.password),
        role="SACCO_OPERATOR",
        sacco_id=sacco_id,
        terms_accepted=True,
        terms_accepted_at=now_iso,
        terms_signature=signature,
        terms_version=TERMS_VERSION,
    )
    db.add(user)
    stage_audit_log(
        db, resource_type="sacco", resource_id=sacco_id, action="ONBOARDING_STARTED",
        user_id=user_id, new_values={"name": payload.sacco_name, "saccoType": payload.sacco_type},
    )

    try:
        await db.commit()
    except IntegrityError:
        # Same check-then-insert race as auth.py's /register — the pre-check
        # above is a friendly message, the unique constraint is the real
        # guard. Without this, a concurrent onboarding submission for the
        # same email surfaces as an unhandled 500 instead of a clean 400.
        await db.rollback()
        raise HTTPException(status_code=400, detail="User email already registered")
    await db.refresh(user)

    dispatcher.dispatch("SACCO_ONBOARDING_SUBMITTED", {"sacco_id": sacco_id, "user_id": user_id})

    token_data = {"userId": user.id, "name": user.name, "role": user.role, "saccoId": user.sacco_id}
    access_token = create_access_token(data=token_data)
    return Token(access_token=access_token, token_type="bearer", user=UserResponse.model_validate(user))


@router.post("/{sacco_id}/documents", response_model=SaccoResponse)
async def upload_sacco_document(
    sacco_id: str,
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(requires_permission("manage_sacco_documents")),
    db: AsyncSession = Depends(get_db),
):
    enforce_own_sacco_operator_only(current_user, sacco_id, "You can only manage documents for your own Sacco.")

    field_name = DOC_FIELD_MAP.get(doc_type)
    if not field_name:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = result.scalars().first()
    if not sacco:
        raise HTTPException(status_code=404, detail="Sacco not found")

    sacco_dir = os.path.join(UPLOAD_ROOT, sacco_id)
    os.makedirs(sacco_dir, exist_ok=True)

    safe_name = os.path.basename(file.filename or "document")
    stored_name = f"{doc_type}_{uuid.uuid4().hex[:8]}_{safe_name}"
    dest_path = os.path.join(sacco_dir, stored_name)
    contents = await file.read()
    with open(dest_path, "wb") as f:
        f.write(contents)

    setattr(sacco, field_name, f"/uploads/saccos/{sacco_id}/{stored_name}")
    stage_audit_log(
        db, resource_type="sacco", resource_id=sacco_id, action="DOCUMENT_UPLOADED",
        user_id=current_user.id, new_values={"docType": doc_type, "filename": safe_name},
    )

    await db.commit()
    await db.refresh(sacco)
    return sacco


@router.patch("/{sacco_id}/officials", response_model=SaccoResponse)
async def update_sacco_officials(
    sacco_id: str,
    payload: SaccoOfficialsUpdate,
    current_user: User = Depends(requires_permission("manage_sacco_documents")),
    db: AsyncSession = Depends(get_db),
):
    enforce_own_sacco_operator_only(current_user, sacco_id, "You can only manage officials for your own Sacco.")

    result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = result.scalars().first()
    if not sacco:
        raise HTTPException(status_code=404, detail="Sacco not found")

    sacco.doc_officials_contacts = json.dumps(payload.model_dump(by_alias=True))
    stage_audit_log(
        db, resource_type="sacco", resource_id=sacco_id, action="OFFICIALS_UPDATED",
        user_id=current_user.id, new_values=payload.model_dump(by_alias=True),
    )
    await db.commit()
    await db.refresh(sacco)
    return sacco


@router.post("/{sacco_id}/submit-application", response_model=SaccoResponse)
async def submit_application(
    sacco_id: str,
    current_user: User = Depends(requires_permission("manage_sacco_documents")),
    db: AsyncSession = Depends(get_db),
):
    """
    Marks the onboarding wizard as complete. Nothing goes into the Director/
    Chief Officer's review queue as a "real" submission until this fires —
    an operator who has only partially filled the wizard and abandoned it
    shouldn't show up looking like a finished application.
    """
    enforce_own_sacco_operator_only(current_user, sacco_id, "You can only submit your own Sacco's application.")

    result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = result.scalars().first()
    if not sacco:
        raise HTTPException(status_code=404, detail="Sacco not found")

    missing = _missing_mandatory_docs(sacco)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot submit - still missing: {', '.join(missing)}.",
        )

    if not sacco.application_submitted_at:
        sacco.application_submitted_at = datetime.datetime.now(datetime.timezone.utc)
        stage_audit_log(
            db, resource_type="sacco", resource_id=sacco_id, action="APPLICATION_SUBMITTED",
            user_id=current_user.id, new_values={"applicationSubmittedAt": sacco.application_submitted_at},
        )
        await db.commit()
        await db.refresh(sacco)

        dispatcher.dispatch("SACCO_APPLICATION_SUBMITTED", {"sacco_id": sacco.id})

    return sacco


@router.patch("/{sacco_id}/verification", response_model=SaccoResponse)
async def update_sacco_verification(
    sacco_id: str,
    update_data: SaccoVerificationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(requires_permission("verify_saccos")),
):
    result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = result.scalars().first()

    if not sacco:
        raise HTTPException(status_code=404, detail="Sacco not found")

    old_status = sacco.status
    sacco.status = update_data.status
    if update_data.reason:
        sacco.rejection_reason = update_data.reason

    stage_audit_log(
        db, resource_type="sacco", resource_id=sacco_id, action="VERIFICATION_STATUS_CHANGED",
        user_id=current_user.id, old_values={"status": old_status}, new_values={"status": update_data.status, "reason": update_data.reason},
    )
    await db.commit()
    await db.refresh(sacco)
    return sacco


@router.patch("/{sacco_id}/verification/director", response_model=SaccoResponse)
async def decide_director_mobility_stage(
    sacco_id: str,
    payload: VerificationStageDecision,
    current_user: User = Depends(requires_permission("decide_operator_verification_stage1")),
    db: AsyncSession = Depends(get_db),
):
    if payload.status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="status must be APPROVED or REJECTED")

    result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = result.scalars().first()
    if not sacco:
        raise HTTPException(status_code=404, detail="Sacco not found")

    if payload.status == "APPROVED":
        if not sacco.application_submitted_at:
            raise HTTPException(
                status_code=400,
                detail="This operator hasn't finished and submitted their onboarding application yet.",
            )
        missing = _missing_mandatory_docs(sacco)
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve - missing mandatory documents: {', '.join(missing)}.",
            )

    sacco.director_mobility_status = payload.status
    sacco.director_mobility_reason = payload.reason
    sacco.director_mobility_decided_by = current_user.name
    sacco.director_mobility_decided_at = datetime.datetime.now(datetime.timezone.utc)

    if payload.status == "REJECTED":
        sacco.status = "REJECTED"
        sacco.rejection_reason = payload.reason

    stage_audit_log(
        db, resource_type="sacco", resource_id=sacco_id, action="STAGE1_DIRECTOR_DECIDED",
        user_id=current_user.id, new_values={"status": payload.status, "reason": payload.reason, "decidedBy": current_user.name},
    )
    await db.commit()
    await db.refresh(sacco)

    dispatcher.dispatch("SACCO_VERIFICATION_STAGE1_DECIDED", {
        "sacco_id": sacco.id, "status": payload.status, "user_id": current_user.id,
    })
    if payload.status == "APPROVED":
        await _notify_sacco_operators(
            db, sacco.id, "Stage 1 approved",
            f"the Director of Mobility has approved {sacco.name}'s application. It now awaits the Chief Officer's final review.",
            "success",
        )
    else:
        await _notify_sacco_operators(
            db, sacco.id, "Application rejected",
            f"{sacco.name}'s application was rejected at Stage 1: {payload.reason or 'no reason given'}.",
            "error",
        )
    return sacco


@router.patch("/{sacco_id}/verification/chief-officer", response_model=SaccoResponse)
async def decide_chief_officer_stage(
    sacco_id: str,
    payload: VerificationStageDecision,
    current_user: User = Depends(requires_permission("decide_operator_verification_stage2")),
    db: AsyncSession = Depends(get_db),
):
    if payload.status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="status must be APPROVED or REJECTED")

    result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = result.scalars().first()
    if not sacco:
        raise HTTPException(status_code=404, detail="Sacco not found")

    if sacco.director_mobility_status != "APPROVED":
        raise HTTPException(
            status_code=400,
            detail="This Sacco has not yet been approved by the Director of Mobility (stage 1).",
        )

    if payload.status == "APPROVED":
        missing = _missing_mandatory_docs(sacco)
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve - missing mandatory documents: {', '.join(missing)}.",
            )

    sacco.chief_officer_status = payload.status
    sacco.chief_officer_reason = payload.reason
    sacco.chief_officer_decided_by = current_user.name
    sacco.chief_officer_decided_at = datetime.datetime.now(datetime.timezone.utc)

    if payload.status == "APPROVED":
        sacco.status = "ACTIVE"
    else:
        sacco.status = "REJECTED"
        sacco.rejection_reason = payload.reason

    stage_audit_log(
        db, resource_type="sacco", resource_id=sacco_id, action="STAGE2_CHIEF_OFFICER_DECIDED",
        user_id=current_user.id, new_values={"status": payload.status, "reason": payload.reason, "decidedBy": current_user.name},
    )
    await db.commit()
    await db.refresh(sacco)

    dispatcher.dispatch("SACCO_VERIFICATION_STAGE2_DECIDED", {
        "sacco_id": sacco.id, "status": payload.status, "user_id": current_user.id,
    })
    if payload.status == "APPROVED":
        await _notify_sacco_operators(
            db, sacco.id, "You're fully verified! 🎉",
            f"the Chief Officer has approved {sacco.name}. Your Operator Dashboard is now fully unlocked.",
            "success",
        )
    else:
        await _notify_sacco_operators(
            db, sacco.id, "Application rejected",
            f"{sacco.name}'s application was rejected at final review: {payload.reason or 'no reason given'}.",
            "error",
        )
    return sacco


@router.post("/{sacco_id}/license/submit-payment", response_model=SaccoResponse)
async def submit_license_renewal_payment(
    sacco_id: str,
    current_user: User = Depends(requires_permission("submit_license_renewal")),
    db: AsyncSession = Depends(get_db),
):
    """
    Sacco-initiated monthly permit renewal payment. Not wired to a real payment
    gateway yet (NairobiPay integration pending) — records the submission as
    awaiting county approval, matching the intended pay-then-approve flow.
    """
    enforce_own_sacco_operator_only(current_user, sacco_id, "You can only submit renewal payment for your own Sacco.")

    result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = result.scalars().first()
    if not sacco:
        raise HTTPException(status_code=404, detail="Sacco not found")

    sacco.license_status = "RENEWAL_SUBMITTED"
    stage_audit_log(
        db, resource_type="sacco_license", resource_id=sacco_id, action="RENEWAL_SUBMITTED",
        user_id=current_user.id, new_values={"status": "RENEWAL_SUBMITTED"},
    )
    await db.commit()
    await db.refresh(sacco)

    dispatcher.dispatch("SACCO_LICENSE_RENEWAL_SUBMITTED", {
        "sacco_id": sacco.id,
        "user_id": current_user.id,
    })
    return sacco

@router.patch("/{sacco_id}/license/approve", response_model=SaccoResponse)
async def approve_license_renewal(
    sacco_id: str,
    payload: LicenseRenewalDecision,
    current_user: User = Depends(requires_permission("approve_license_renewal")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Sacco).where(Sacco.id == sacco_id))
    sacco = result.scalars().first()
    if not sacco:
        raise HTTPException(status_code=404, detail="Sacco not found")

    if sacco.license_status != "RENEWAL_SUBMITTED":
        raise HTTPException(status_code=400, detail="This Sacco has no pending license renewal to approve.")

    old_status = sacco.license_status
    sacco.license_status = "ACTIVE" if payload.approve else "RENEWAL_DUE"
    stage_audit_log(
        db, resource_type="sacco_license", resource_id=sacco_id, action="RENEWAL_DECIDED",
        user_id=current_user.id, old_values={"status": old_status}, new_values={"status": sacco.license_status, "approved": payload.approve},
    )
    await db.commit()
    await db.refresh(sacco)

    dispatcher.dispatch("SACCO_LICENSE_RENEWAL_DECIDED", {
        "sacco_id": sacco.id,
        "old_status": old_status,
        "new_status": sacco.license_status,
        "approved": payload.approve,
        "user_id": current_user.id,
    })
    return sacco
