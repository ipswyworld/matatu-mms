import datetime
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import PassengerReport, CrimeRecord, Matatu, User
from app.schemas import PassengerReportResponse, PassengerReportStatusUpdate
from app.auth import requires_permission
from app.audit import stage_audit_log
from app.storage import save_upload

router = APIRouter(prefix="/api/reports", tags=["Passenger Reports"])

CATEGORY_TO_OFFENCE = {
    "Overcharging Complaint": "Overcharging Beyond Gazetted Fare (Passenger Reported)",
    "Reckless Driving": "Reckless Driving / Speeding (Passenger Reported)",
    "Loud Music / Noise Violation": "Loud Music / Noise Violation (Passenger Reported)",
    "Expired Route Badge": "Crew Missing Badges / Uniforms (Passenger Reported)",
}

@router.get("", response_model=List[PassengerReportResponse])
async def get_reports(
    current_user: User = Depends(requires_permission("view_reports")),
    db: AsyncSession = Depends(get_db),
):
    query = select(PassengerReport).order_by(PassengerReport.created_at.desc())
    # PassengerReport.matatu_reg_number is a plain string, not a Matatu FK
    # (the report can reference a vehicle from any Sacco) — so scoping a
    # Sacco Operator/Crew account to their own fleet needs an explicit
    # subquery on reg_number rather than the usual join-on-sacco_id
    # pattern (app.abac.sacco_scope_query doesn't fit this shape). Without
    # this, any operator account could read every passenger complaint
    # county-wide, not just ones about their own vehicles.
    if current_user.role in ("SACCO_OPERATOR", "CREW"):
        own_reg_numbers = select(Matatu.reg_number).where(Matatu.sacco_id == current_user.sacco_id)
        query = query.where(PassengerReport.matatu_reg_number.in_(own_reg_numbers))
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/public-comment", status_code=status.HTTP_201_CREATED)
async def create_public_comment(
    message: str = Form(...),
    reporter_name: Optional[str] = Form(None),
    reporter_phone: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Unauthenticated feedback channel for the public login page ('Leave a comment')."""
    message = message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")

    report_id = f"rep-{uuid.uuid4().hex[:8]}"
    new_report = PassengerReport(
        id=report_id,
        category="Site Feedback",
        message=message,
        reporter_user_id=None,
        reporter_name=reporter_name or None,
        reporter_phone=reporter_phone or None,
        photo_path=None,
        status="PENDING",
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(new_report)
    await db.commit()
    return {"ok": True}

@router.post("", response_model=PassengerReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(
    category: str = Form(...),
    message: str = Form(...),
    matatu_reg_number: Optional[str] = Form(None),
    reporter_name: Optional[str] = Form(None),
    reporter_phone: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    current_user: User = Depends(requires_permission("submit_report")),
    db: AsyncSession = Depends(get_db),
):
    report_id = f"rep-{uuid.uuid4().hex[:8]}"

    photo_path = None
    if photo is not None and photo.filename:
        contents = await photo.read()
        photo_path = await save_upload("passenger_reports", report_id, photo.filename, contents, db=db)

    new_report = PassengerReport(
        id=report_id,
        matatu_reg_number=(matatu_reg_number or "").upper().strip() or None,
        category=category,
        message=message.strip(),
        reporter_user_id=current_user.id,
        reporter_name=reporter_name or current_user.name,
        reporter_phone=reporter_phone,
        photo_path=photo_path,
        status="PENDING",
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(new_report)
    await db.commit()
    await db.refresh(new_report)
    return new_report

@router.patch("/{report_id}/status", response_model=PassengerReportResponse)
async def update_report_status(
    report_id: str,
    payload: PassengerReportStatusUpdate,
    current_user: User = Depends(requires_permission("review_report")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PassengerReport).where(PassengerReport.id == report_id))
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    new_status = payload.status.upper().strip()
    if new_status not in ("PENDING", "REVIEWED", "ESCALATED", "DISMISSED"):
        raise HTTPException(status_code=400, detail="Invalid status value")

    old_status = report.status
    report.status = new_status
    stage_audit_log(
        db, resource_type="passenger_report", resource_id=report_id, action="STATUS_CHANGE",
        user_id=current_user.id, old_values={"status": old_status}, new_values={"status": new_status},
    )

    # Escalating a report opens a real crime/citation record so it enters the enforcement ledger
    if new_status == "ESCALATED":
        crime_id = f"crime-{uuid.uuid4().hex[:8]}"
        db.add(CrimeRecord(
            id=crime_id,
            offence_committed=CATEGORY_TO_OFFENCE.get(report.category, f"{report.category} (Passenger Reported)"),
            reg_number=report.matatu_reg_number or "UNKNOWN",
            driver_name="Unknown (escalated from passenger report)",
            driver_license="N/A",
            location="Reported via Passenger App",
            fine_amount_kes=0.0,
            remarks=report.message,
            officer_id=current_user.id,
            timestamp=datetime.datetime.now(datetime.timezone.utc),
            status="PENDING",
        ))

    await db.commit()
    await db.refresh(report)
    return report
