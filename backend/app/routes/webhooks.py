import datetime
import json
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import WebhookSubscription, WebhookLog, User, Sacco
from app.schemas import WebhookSubscriptionCreate, WebhookSubscriptionResponse, WebhookLogResponse
from app.auth import get_current_user
from app.events import dispatcher
from app.abac import sacco_scope_query, enforce_own_sacco

router = APIRouter(prefix="/api/webhooks", tags=["Webhooks Simulator"])

@router.post("/subscriptions", response_model=WebhookSubscriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_subscription(
    payload: WebhookSubscriptionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    enforce_own_sacco(current_user, payload.sacco_id, "Sacco Operators can only subscribe for their own fleet events.")


    # Verify Sacco exists
    sacco_result = await db.execute(select(Sacco).where(Sacco.id == payload.sacco_id))
    if not sacco_result.scalars().first():
        raise HTTPException(status_code=400, detail="Invalid Sacco ID")

    # Verify events list
    valid_events = ["FINE_ISSUED", "FINE_STATUS_CHANGED", "VEHICLE_STATUS_CHANGED"]
    for e in payload.events:
        if e not in valid_events:
            raise HTTPException(status_code=400, detail=f"Invalid event: {e}. Allowed: {valid_events}")

    new_sub = WebhookSubscription(
        url=payload.url,
        sacco_id=payload.sacco_id,
        events=",".join(payload.events),
        active=True
    )
    db.add(new_sub)
    await db.commit()
    await db.refresh(new_sub)
    return new_sub

@router.get("/subscriptions", response_model=List[WebhookSubscriptionResponse])
async def get_subscriptions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(WebhookSubscription)
    query = sacco_scope_query(current_user, query, WebhookSubscription.sacco_id)

    result = await db.execute(query)
    return result.scalars().all()

@router.get("/logs", response_model=List[WebhookLogResponse])
async def get_webhook_logs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(WebhookLog).join(
        WebhookSubscription,
        WebhookLog.subscription_id == WebhookSubscription.id
    )
    
    query = sacco_scope_query(current_user, query, WebhookSubscription.sacco_id)

    query = query.order_by(WebhookLog.timestamp.desc()).limit(100)
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/simulator/trigger")
async def trigger_simulator_event(
    event_type: str,
    sacco_id: str,
    payload_data: dict,
    current_user: User = Depends(get_current_user)
):
    """
    Manually triggers an event in the pub/sub system.
    This simulates real-world actions for webhook verification testing.
    """
    valid_events = ["FINE_ISSUED", "FINE_STATUS_CHANGED", "VEHICLE_STATUS_CHANGED"]
    if event_type not in valid_events:
        raise HTTPException(status_code=400, detail=f"Invalid event: {event_type}. Allowed: {valid_events}")
        
    # Inject Sacco & user performing simulation
    data = payload_data.copy()
    data["sacco_id"] = sacco_id
    data["user_id"] = current_user.id
    
    # Dispatch event
    dispatcher.dispatch(event_type, data)
    
    return {"message": f"Event '{event_type}' dispatched successfully to listeners."}
