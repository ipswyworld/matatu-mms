import datetime
import os
import random
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import CrimeRecord, User, Matatu, Fine
from app.schemas import CrimeRecordResponse
from app.auth import get_current_user, requires_permission
from app.audit import stage_audit_log

router = APIRouter(prefix="/api/enforcement/crimes", tags=["Enforcement Crimes"])

UPLOAD_ROOT = os.path.join(os.getcwd(), "uploads", "crime_records")

@router.get("", response_model=List[CrimeRecordResponse])
async def get_crimes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(CrimeRecord)
        .options(selectinload(CrimeRecord.officer))
        .order_by(CrimeRecord.timestamp.desc())
    )
    crimes = result.scalars().all()
    
    for c in crimes:
        if c.officer and not getattr(c, "officer_name", None):
            c.officer_name = c.officer.name
            
    return crimes

@router.post("", response_model=CrimeRecordResponse, status_code=status.HTTP_201_CREATED)
async def create_crime(
    offence_committed: str = Form(...),
    reg_number: str = Form(...),
    driver_name: str = Form(...),
    driver_license: str = Form(...),
    location: str = Form(...),
    fine_amount_kes: float = Form(0.0),
    remarks: Optional[str] = Form(None),
    photo: UploadFile = File(...),
    current_user: User = Depends(requires_permission("record_crime")),
    db: AsyncSession = Depends(get_db)
):
    if not photo.filename:
        raise HTTPException(status_code=400, detail="Photo evidence is required.")

    crime_id = f"crime-{random.randint(10000, 99999)}"
    now_iso = datetime.datetime.now().isoformat()
    reg_number_normalized = reg_number.upper().strip()

    record_dir = os.path.join(UPLOAD_ROOT, crime_id)
    os.makedirs(record_dir, exist_ok=True)
    safe_name = os.path.basename(photo.filename)
    stored_name = f"{uuid.uuid4().hex[:8]}_{safe_name}"
    contents = await photo.read()
    with open(os.path.join(record_dir, stored_name), "wb") as f:
        f.write(contents)
    photo_path = f"/uploads/crime_records/{crime_id}/{stored_name}"

    new_crime = CrimeRecord(
        id=crime_id,
        offence_committed=offence_committed,
        reg_number=reg_number_normalized,
        driver_name=driver_name,
        driver_license=driver_license,
        location=location,
        fine_amount_kes=fine_amount_kes,
        remarks=remarks,
        officer_id=current_user.id,
        timestamp=now_iso,
        status="PENDING",
        photo_path=photo_path,
    )

    db.add(new_crime)
    stage_audit_log(
        db, resource_type="crime_record", resource_id=crime_id, action="CREATE",
        user_id=current_user.id,
        new_values={"offenceCommitted": offence_committed, "regNumber": reg_number_normalized, "fineAmountKes": fine_amount_kes},
    )

    # Also auto-flag or fine the matatu if it exists in DB
    matatu_result = await db.execute(select(Matatu).where(Matatu.reg_number == reg_number_normalized))
    matatu = matatu_result.scalars().first()
    if matatu and matatu.status == "ACTIVE":
        matatu.status = "FLAGGED"

    await db.commit()
    
    result = await db.execute(
        select(CrimeRecord)
        .options(selectinload(CrimeRecord.officer))
        .where(CrimeRecord.id == crime_id)
    )
    crime = result.scalars().first()
    if crime and crime.officer:
        crime.officer_name = crime.officer.name
    return crime
