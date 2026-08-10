import datetime
import random
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ActivityLog, Matatu, User
from app.schemas import ActivityLogResponse, ActivityLogCreate
from app.auth import get_current_user, requires_permission

router = APIRouter(prefix="/api/activity", tags=["Activity Logs"])

@router.get("", response_model=List[ActivityLogResponse])
async def get_activities(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(ActivityLog).join(Matatu, ActivityLog.matatu_id == Matatu.id)
    
    # Filter logs by Sacco if user is Sacco Operator
    if current_user.role == "SACCO_OPERATOR":
        query = query.where(Matatu.sacco_id == current_user.sacco_id)
        
    query = query.order_by(ActivityLog.timestamp.desc())
    result = await db.execute(query)
    return result.scalars().all()

@router.post("", response_model=ActivityLogResponse, status_code=status.HTTP_201_CREATED)
async def create_activity(
    payload: ActivityLogCreate,
    current_user: User = Depends(requires_permission("log_activity")),
    db: AsyncSession = Depends(get_db)
):
    # Verify vehicle exists
    vehicle_result = await db.execute(select(Matatu).where(Matatu.id == payload.matatu_id))
    matatu = vehicle_result.scalars().first()
    if not matatu:
        raise HTTPException(status_code=404, detail="Matatu vehicle not found")
        
    # Generate unique ID
    count_result = await db.execute(select(ActivityLog))
    total_count = len(count_result.scalars().all())
    activity_id = f"a-{1000 + total_count + random.randint(1, 99)}"

    new_activity = ActivityLog(
        id=activity_id,
        matatu_id=payload.matatu_id,
        type=payload.type.upper().strip(),
        description=payload.description.strip(),
        location=payload.location.strip(),
        officer_id=current_user.id,
        timestamp=datetime.datetime.utcnow().isoformat() + "Z"
    )
    
    db.add(new_activity)
    await db.commit()
    await db.refresh(new_activity)
    return new_activity
