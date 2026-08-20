import datetime
import random
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ActivityLog, Matatu, User
from app.schemas import ActivityLogResponse, ActivityLogCreate
from app.auth import get_current_user, requires_permission
from app.abac import sacco_scope_query
from app.events import dispatcher
from app.routes.notifications import notify_user

router = APIRouter(prefix="/api/activity", tags=["Activity Logs"])

@router.get("", response_model=List[ActivityLogResponse])
async def get_activities(
    limit: int = Query(200, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Bounded, most-recent-first. ActivityLog.timestamp is still a String
    # column (see ARCHITECTURE_DECISIONS.md §21.2 — that migration is a
    # separate tracked task), so this is a limit cap rather than a full
    # keyset cursor for now; id isn't a real auto-incrementing key here
    # either (unlike AuditLog), so it can't be used as one until that
    # column-type work lands.
    query = select(ActivityLog).join(Matatu, ActivityLog.matatu_id == Matatu.id)
    query = sacco_scope_query(current_user, query, Matatu.sacco_id)
    query = query.order_by(ActivityLog.timestamp.desc()).limit(limit)
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
        timestamp=datetime.datetime.now(datetime.timezone.utc)
    )
    
    db.add(new_activity)
    await db.commit()
    await db.refresh(new_activity)

    # Crew's "Send Rapid Incident Alert" (matatu-mms-public's crew portal)
    # used to just write this row silently — nobody was ever told. Notify
    # the vehicle's own Sacco operator(s) live (same notify_user pattern as
    # enforcement_cases.py) and nudge any open admin/enforcement dashboard,
    # so an incident a crew member reports is actually seen, not only
    # discoverable by someone happening to open the Activity Log later.
    if new_activity.type == "INCIDENT" and matatu.sacco_id:
        operators_result = await db.execute(
            select(User).where(User.role == "SACCO_OPERATOR", User.sacco_id == matatu.sacco_id)
        )
        for operator in operators_result.scalars().all():
            await notify_user(
                operator.id, title="Crew incident alert",
                message=f"{matatu.reg_number} — {new_activity.location}: {new_activity.description}",
                level="warning",
            )
        dispatcher.dispatch("CREW_INCIDENT_ALERT", {
            "activity_id": new_activity.id, "matatu_id": matatu.id, "reg_number": matatu.reg_number,
        })

    return new_activity
