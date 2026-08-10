from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import List

from app.database import get_db
from app.models import Matatu, Fine, ActivityLog, User
from app.schemas import DashboardStats, ActivityLogResponse
from app.auth import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard Oversight"])

@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Base queries
    matatu_query = select(func.count(Matatu.id))
    flagged_query = select(func.count(Matatu.id)).where(Matatu.status == "FLAGGED")
    impounded_query = select(func.count(Matatu.id)).where(Matatu.status == "IMPOUNDED")
    
    fines_query = select(
        func.count(Fine.id).label("count"),
        func.coalesce(func.sum(Fine.amount_kes), 0.0).label("value")
    ).where(Fine.status == "PENDING")
    
    activity_query = select(ActivityLog).join(Matatu, ActivityLog.matatu_id == Matatu.id).order_by(ActivityLog.timestamp.desc()).limit(5)

    # Apply Sacco Operators filtering
    if current_user.role == "SACCO_OPERATOR":
        sacco_id = current_user.sacco_id
        matatu_query = matatu_query.where(Matatu.sacco_id == sacco_id)
        flagged_query = flagged_query.where(Matatu.sacco_id == sacco_id)
        impounded_query = impounded_query.where(Matatu.sacco_id == sacco_id)
        
        fines_query = fines_query.join(Matatu, Fine.matatu_id == Matatu.id).where(Matatu.sacco_id == sacco_id)
        activity_query = activity_query.where(Matatu.sacco_id == sacco_id)

    # Execute all queries concurrently (Python async coroutines gather)
    import asyncio
    
    # We execute them in parallel using asyncio.gather (Promises)
    total_fleet_task = db.execute(matatu_query)
    flagged_task = db.execute(flagged_query)
    impounded_task = db.execute(impounded_query)
    fines_task = db.execute(fines_query)
    activity_task = db.execute(activity_query)
    
    results = await asyncio.gather(
        total_fleet_task,
        flagged_task,
        impounded_task,
        fines_task,
        activity_task
    )
    
    total_fleet = results[0].scalar() or 0
    flagged = results[1].scalar() or 0
    impounded = results[2].scalar() or 0
    
    fines_row = results[3].all()[0]
    fines_count = fines_row[0] or 0
    fines_value = fines_row[1] or 0.0
    
    recent_activities = results[4].scalars().all()
    
    return DashboardStats(
        total_fleet=total_fleet,
        flagged_vehicles=flagged,
        impounded_vehicles=impounded,
        pending_fines_count=fines_count,
        pending_fines_value=fines_value,
        recent_activity=recent_activities
    )
