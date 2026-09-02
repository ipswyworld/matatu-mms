import json
import datetime
import time
import asyncio
import logging
import httpx
from sqlalchemy.future import select

from app.database import AsyncSessionLocal
from app.models import WebhookSubscription, WebhookLog
from app.events import dispatcher
from app.resilience import CircuitBreaker, CircuitBreakerOpenException, retry_async
from app import ops_breakers
from app.config import WEBHOOK_MAX_RETRIES

logger = logging.getLogger("app.listeners")

# Dictionary to keep track of circuit breakers per subscription ID
subscription_breakers = {}

# --- Event Listeners ---
#
# Audit-trail writes used to live here as event listeners, each opening its
# own DB session in a separate transaction from the mutation that triggered
# it. That's a reliability gap: if the process died between the route's
# commit and this listener running, the mutation persisted but its audit
# record never did. Audit logging has been moved to `app.audit.stage_audit_log`,
# called directly at each mutation site inside the same transaction. What
# remains here (notifications, webhooks) is fine to stay best-effort/event-driven.

async def notification_listener(event_type: str, data: dict):
    """Simulates sending real-time SMS/WhatsApp messages to Sacco Operators."""
    sacco_id = data.get("sacco_id")
    
    if event_type == "FINE_ISSUED":
        fine = data.get("fine")
        logger.info(
            f"[SIMULATED NOTIFICATION] Sent SMS Alert to Sacco '{sacco_id}': "
            f"New fine issued against vehicle {fine.get('matatuId')}. "
            f"Reason: {fine.get('reason')}. Amount: KES {fine.get('amountKes')}."
        )
    elif event_type == "VEHICLE_STATUS_CHANGED":
        matatu_id = data.get("matatu_id")
        new_status = data.get("new_status")
        logger.info(
            f"[SIMULATED NOTIFICATION] Sent SMS Alert to Sacco '{sacco_id}': "
            f"Vehicle {matatu_id} compliance status changed to {new_status}."
        )
    elif event_type == "BOOKING_CREATED":
        reg_number = data.get("reg_number")
        passenger_name = data.get("passenger_name")
        seat_numbers = data.get("seat_numbers")
        logger.info(
            f"[SIMULATED NOTIFICATION] Sent SMS Alert to Sacco '{sacco_id}': "
            f"New booking on {reg_number} by {passenger_name} for seat(s) {seat_numbers}."
        )

async def post_webhook(client: httpx.AsyncClient, url: str, payload: dict) -> httpx.Response:
    """Performs the actual POST request to the subscriber's webhook endpoint."""
    # httpx's `json=` kwarg serializes with the stdlib json.dumps and no
    # custom encoder, which can't handle the datetime/date/Decimal objects
    # that now flow into event payloads straight from model attributes
    # (e.g. Fine.issued_at, Fine.amount_kes). Serialize explicitly with
    # default=str instead, so a real delivery never silently "fails" with
    # a TypeError before it even reaches the network.
    response = await client.post(
        url,
        content=json.dumps(payload, default=str),
        headers={"Content-Type": "application/json"},
        timeout=5.0,
    )
    response.raise_for_status()
    return response

async def deliver_webhook_with_resilience(
    subscription_id: int,
    url: str,
    event_type: str,
    payload: dict,
    breaker: CircuitBreaker
):
    """Delivers webhook using circuit breaker & retry with exponential backoff."""
    timestamp = datetime.datetime.now(datetime.timezone.utc)  # WebhookLog.timestamp is a real DateTime column
    
    async def make_attempt():
        async with httpx.AsyncClient() as client:
            return await post_webhook(client, url, payload)

    status_code = None
    error_message = None
    attempt = 1

    try:
        # Wrap delivery in circuit breaker
        # Also wrap in retry logic: up to configured retries
        response = await breaker.call(
            retry_async,
            make_attempt,
            retries=WEBHOOK_MAX_RETRIES,
            initial_delay=1.0,
            backoff_factor=2.0,
            allowed_exceptions=(httpx.HTTPError, asyncio.TimeoutError)
        )
        status_code = response.status_code
        logger.info(f"Webhook delivered successfully to {url}. Status: {status_code}")
    except CircuitBreakerOpenException as cbo:
        error_message = "Execution blocked: Circuit Breaker is OPEN"
        logger.warning(f"Webhook delivery to {url} blocked by circuit breaker: {cbo}")
    except Exception as e:
        error_message = str(e)
        logger.error(f"Webhook delivery to {url} failed: {e}")

    # Write attempt log to database
    async with AsyncSessionLocal() as db:
        log = WebhookLog(
            subscription_id=subscription_id,
            event_type=event_type,
            # default=str: event payloads embed raw model attributes (e.g.
            # Fine.issued_at, Fine.amount_kes) that are now real datetime/
            # date/Decimal objects, none of which json.dumps handles by
            # default. str() is a fine representation for an outbound
            # webhook log — this is a record of what was sent, not a value
            # anything parses back.
            payload=json.dumps(payload, default=str),
            status_code=status_code,
            error_message=error_message,
            attempt=WEBHOOK_MAX_RETRIES,  # Max retries hit or successful retry
            timestamp=timestamp
        )
        db.add(log)
        await db.commit()

async def webhook_dispatcher_listener(event_type: str, data: dict):
    """Searches active subscriptions and schedules resilient webhook deliveries."""
    sacco_id = data.get("sacco_id")
    if not sacco_id:
        return

    # Open short database session to retrieve matching subscribers
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(WebhookSubscription).where(
                WebhookSubscription.sacco_id == sacco_id,
                WebhookSubscription.active == True
            )
        )
        subscriptions = result.scalars().all()

    for sub in subscriptions:
        subscribed_events = [e.strip() for e in sub.events.split(",")]
        if event_type not in subscribed_events:
            continue

        # Get or create breaker for this subscription. Also registered by
        # name in app/ops_breakers.py so the ops console can see that a
        # subscription's breaker has tripped and manually hold it open or
        # closed — previously these existed only in this dict, invisible and
        # untouchable from outside this module.
        if sub.id not in subscription_breakers:
            subscription_breakers[sub.id] = ops_breakers.get_or_create(
                f"webhook:{sub.id}",
                failure_threshold=3,
                recovery_time=30.0,
                description=f"Webhook delivery to subscription {sub.id}",
            )

        breaker = subscription_breakers[sub.id]
        
        payload = {
            "eventId": f"evt-{int(time.time() * 1000)}",
            "eventType": event_type,
            "saccoId": sacco_id,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "data": data
        }

        # Schedule delivery concurrently in background
        asyncio.create_task(
            deliver_webhook_with_resilience(sub.id, sub.url, event_type, payload, breaker)
        )

# --- Register Listeners with Dispatcher ---

def register_listeners():
    dispatcher.register("FINE_ISSUED", notification_listener)
    dispatcher.register("FINE_ISSUED", webhook_dispatcher_listener)

    dispatcher.register("FINE_STATUS_CHANGED", webhook_dispatcher_listener)

    dispatcher.register("VEHICLE_STATUS_CHANGED", notification_listener)
    dispatcher.register("VEHICLE_STATUS_CHANGED", webhook_dispatcher_listener)

    dispatcher.register("BOOKING_CREATED", notification_listener)
    dispatcher.register("BOOKING_CREATED", webhook_dispatcher_listener)

    dispatcher.register("BOOKING_STATUS_CHANGED", webhook_dispatcher_listener)
