import datetime
import json
import os
import secrets
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import WebhookSubscription, WebhookLog, User, Sacco
from app.schemas import WebhookSubscriptionCreate, WebhookSubscriptionResponse, WebhookLogResponse, WebhookSecretResponse, WebhookSubscriptionCreateResponse
from app.audit import stage_audit_log
from app.auth import get_current_user, requires_permission
from app.events import dispatcher
from app.abac import sacco_scope_query, enforce_own_sacco
from app.security import validate_public_webhook_url, UnsafeWebhookUrlError

WEBHOOK_SECRET_PREFIX = "whsec_"

router = APIRouter(prefix="/api/webhooks", tags=["Webhooks Simulator"])

@router.post("/subscriptions", response_model=WebhookSubscriptionCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_subscription(
    payload: WebhookSubscriptionCreate,
    current_user: User = Depends(requires_permission("manage_webhooks")),
    db: AsyncSession = Depends(get_db)
):
    enforce_own_sacco(current_user, payload.sacco_id, "Sacco Operators can only subscribe for their own fleet events.")

    # SSRF guard (§21.3) — skipped only when TESTING=1 (set explicitly by
    # test_backend.py, which deliberately registers a loopback URL to
    # simulate a delivery failure), never based on which database is in
    # use — a Postgres-backed test run (Task 12's CI job) still shouldn't
    # accept a real production webhook target pointed at an internal
    # address just because it happens to be running against Postgres.
    if os.getenv("TESTING") != "1":
        try:
            validate_public_webhook_url(payload.url)
        except UnsafeWebhookUrlError as e:
            raise HTTPException(status_code=400, detail=str(e))


    # Verify Sacco exists
    sacco_result = await db.execute(select(Sacco).where(Sacco.id == payload.sacco_id))
    if not sacco_result.scalars().first():
        raise HTTPException(status_code=400, detail="Invalid Sacco ID")

    # Verify events list
    valid_events = ["FINE_ISSUED", "FINE_STATUS_CHANGED", "VEHICLE_STATUS_CHANGED"]
    for e in payload.events:
        if e not in valid_events:
            raise HTTPException(status_code=400, detail=f"Invalid event: {e}. Allowed: {valid_events}")

    secret = WEBHOOK_SECRET_PREFIX + secrets.token_urlsafe(32)
    new_sub = WebhookSubscription(
        url=payload.url,
        sacco_id=payload.sacco_id,
        events=",".join(payload.events),
        active=True,
        secret=secret,
    )
    db.add(new_sub)
    await db.flush()

    stage_audit_log(
        db, resource_type="webhook_subscription", resource_id=str(new_sub.id), action="CREATE",
        user_id=current_user.id,
        new_values={"url": payload.url, "saccoId": payload.sacco_id, "events": payload.events},
    )
    await db.commit()
    await db.refresh(new_sub)
    return WebhookSubscriptionCreateResponse(
        id=new_sub.id, url=new_sub.url, sacco_id=new_sub.sacco_id,
        events=new_sub.events, active=new_sub.active, secret=secret,
    )


@router.post("/subscriptions/{subscription_id}/rotate-secret", response_model=WebhookSecretResponse)
async def rotate_subscription_secret(
    subscription_id: int,
    current_user: User = Depends(requires_permission("manage_webhooks")),
    db: AsyncSession = Depends(get_db),
):
    """Issues a new signing secret for an existing subscription, replacing
    the old one immediately — the same 'shown once, no recovery path'
    pattern as ApiClient credentials. The old secret stops signing anything
    the moment this commits; the subscriber must be updated with the new
    one before the next delivery, or signature verification on their side
    will start failing."""
    sub = (
        await db.execute(select(WebhookSubscription).where(WebhookSubscription.id == subscription_id))
    ).scalars().first()
    if sub is None:
        raise HTTPException(status_code=404, detail="No webhook subscription with that id")
    enforce_own_sacco(current_user, sub.sacco_id, "You can only rotate the secret for your own Sacco's webhooks.")

    new_secret = WEBHOOK_SECRET_PREFIX + secrets.token_urlsafe(32)
    sub.secret = new_secret

    stage_audit_log(
        db, resource_type="webhook_subscription", resource_id=str(subscription_id), action="ROTATE_SECRET",
        user_id=current_user.id, new_values={"rotatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()},
    )
    await db.commit()
    return WebhookSecretResponse(id=subscription_id, secret=new_secret)

@router.get("/subscriptions", response_model=List[WebhookSubscriptionResponse])
async def get_subscriptions(
    current_user: User = Depends(requires_permission("manage_webhooks")),
    db: AsyncSession = Depends(get_db)
):
    query = select(WebhookSubscription)
    query = sacco_scope_query(current_user, query, WebhookSubscription.sacco_id)

    result = await db.execute(query)
    return result.scalars().all()

@router.get("/logs", response_model=List[WebhookLogResponse])
async def get_webhook_logs(
    current_user: User = Depends(requires_permission("manage_webhooks")),
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
    current_user: User = Depends(requires_permission("manage_webhooks"))
):
    """
    Manually triggers an event in the pub/sub system.
    This simulates real-world actions for webhook verification testing.
    """
    # A Sacco Operator may only fire test events at their own subscriptions
    # — without this, any operator could forge FINE_ISSUED/etc. events with
    # arbitrary payload_data against another Sacco's real registered
    # webhook endpoint. Admin/Superadmin oversight stays unrestricted.
    enforce_own_sacco(current_user, sacco_id, "You can only trigger test events for your own Sacco's webhooks.")

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
