import datetime
import random
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import CrimeRecord, User, Matatu, Fine
from app.schemas import CrimeRecordResponse, CrimeRecordCreate
from app.auth import get_current_user, requires_permission
from app.audit import stage_audit_log

router = APIRouter(prefix="/api/enforcement/crimes", tags=["Enforcement Crimes"])

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
    payload: CrimeRecordCreate,
    current_user: User = Depends(requires_permission("record_crime")),
    db: AsyncSession = Depends(get_db)
):
    crime_id = f"crime-{random.randint(10000, 99999)}"
    now_iso = datetime.datetime.now().isoformat()
    
    new_crime = CrimeRecord(
        id=crime_id,
        offence_committed=payload.offence_committed,
        reg_number=payload.reg_number.upper().strip(),
        driver_name=payload.driver_name,
        driver_license=payload.driver_license,
        location=payload.location,
        fine_amount_kes=payload.fine_amount_kes,
        remarks=payload.remarks,
        officer_id=current_user.id,
        timestamp=now_iso,
        status="PENDING"
    )
    
    db.add(new_crime)
    stage_audit_log(
        db, resource_type="crime_record", resource_id=crime_id, action="CREATE",
        user_id=current_user.id,
        new_values={"offenceCommitted": payload.offence_committed, "regNumber": payload.reg_number, "fineAmountKes": payload.fine_amount_kes},
    )

    # Also auto-flag or fine the matatu if it exists in DB
    matatu_result = await db.execute(select(Matatu).where(Matatu.reg_number == payload.reg_number.upper().strip()))
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
