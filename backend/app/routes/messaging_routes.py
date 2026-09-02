"""
Messaging operations: consent, delivery receipts, spend (Readiness List §19).

Three surfaces, with deliberately different authentication:

  * The opt-out and delivery-receipt endpoints are called by the SMS
    provider, not by users, so they authenticate with a shared secret in
    the path — the same pattern app/routes/payments.py already uses for the
    NairobiPay callback, for the same reason: Africa's Talking does not
    sign its callbacks.
  * Spend reporting is staff-only.
  * A user managing their own consent goes through the authenticated path.
"""
import datetime
import hmac
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app import messaging
from app.auth import get_current_user, requires_permission
from app.config import NAIROBIPAY_CALLBACK_SECRET
from app.database import get_db
from app.models import MessageLog, User

logger = logging.getLogger("app.routes.messaging")
router = APIRouter(prefix="/api/messaging", tags=["Messaging"])


class InboundSmsPayload(BaseModel):
    """Africa's Talking inbound-message shape."""
    from_: Optional[str] = None
    to: Optional[str] = None
    text: str = ""
    date: Optional[str] = None
    id: Optional[str] = None

    model_config = {"populate_by_name": True, "extra": "allow"}


class DeliveryReceiptPayload(BaseModel):
    id: str
    status: str          # Success, Failed, Rejected, Buffered
    phoneNumber: Optional[str] = None
    failureReason: Optional[str] = None

    model_config = {"extra": "allow"}


# Words that mean "stop texting me", in both languages this system serves.
# Matching only "STOP" would silently ignore a Swahili-speaking user
# exercising the same right, which is a compliance failure, not a UX gap.
OPT_OUT_KEYWORDS = {"stop", "unsubscribe", "opt out", "optout", "acha", "sitaki", "toka"}
OPT_IN_KEYWORDS = {"start", "subscribe", "opt in", "optin", "anza", "ndio"}


@router.post("/inbound/{callback_token}")
async def inbound_sms(
    callback_token: str,
    payload: InboundSmsPayload,
    db: AsyncSession = Depends(get_db),
):
    """Inbound SMS, chiefly to process STOP replies.

    Consent withdrawal has to be honoured from the channel the person
    received the message on. Requiring someone to log into a web portal to
    stop receiving texts is not a working opt-out.
    """
    if not hmac.compare_digest(callback_token, NAIROBIPAY_CALLBACK_SECRET):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    sender = payload.from_ or getattr(payload, "from", None)
    if not sender:
        raise HTTPException(status_code=422, detail="Missing sender")

    text = (payload.text or "").strip().lower()

    if any(keyword == text or text.startswith(keyword) for keyword in OPT_OUT_KEYWORDS):
        await messaging.record_opt_out(db, sender, source="sms_reply")
        await db.commit()
        return {"handled": "opt_out", "phone": messaging.normalize_phone(sender)}

    if any(keyword == text or text.startswith(keyword) for keyword in OPT_IN_KEYWORDS):
        await messaging.record_opt_in(db, sender, source="sms_reply")
        await db.commit()
        return {"handled": "opt_in", "phone": messaging.normalize_phone(sender)}

    logger.info("Inbound SMS from %s not recognised as a consent command.", sender)
    return {"handled": "ignored"}


@router.post("/delivery-receipt/{callback_token}")
async def delivery_receipt(
    callback_token: str,
    payload: DeliveryReceiptPayload,
    db: AsyncSession = Depends(get_db),
):
    """Provider delivery receipt.

    This is what turns "we sent it" into "it was delivered" — the
    distinction that matters when a fine notice is disputed.
    """
    if not hmac.compare_digest(callback_token, NAIROBIPAY_CALLBACK_SECRET):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    record = (
        await db.execute(
            select(MessageLog).where(MessageLog.provider_message_id == payload.id)
        )
    ).scalars().first()
    if record is None:
        # Not an error: receipts can arrive for messages sent before this
        # tracking existed, or be retried after the log was purged.
        logger.info("Delivery receipt for unknown provider id %s", payload.id)
        return {"matched": False}

    normalized = payload.status.strip().lower()
    if normalized == "success":
        record.status = "DELIVERED"
        record.delivered_at = datetime.datetime.now(datetime.timezone.utc)
    else:
        record.status = "UNDELIVERED"
        record.error = payload.failureReason or payload.status

    await db.commit()
    return {"matched": True, "status": record.status}


@router.get("/spend")
async def messaging_spend(
    days: int = 30,
    current_user: User = Depends(requires_permission("view_reports")),
    db: AsyncSession = Depends(get_db),
):
    """What messaging has cost, by category and outcome."""
    if days < 1 or days > 365:
        raise HTTPException(status_code=400, detail="days must be between 1 and 365")
    return await messaging.spend_summary(db, days=days)


@router.get("/consent/me")
async def my_consent(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.phone:
        return {"phone": None, "optedOut": False, "note": "No phone number on this account."}
    opted_out = await messaging.is_opted_out(db, current_user.phone)
    return {
        "phone": messaging.normalize_phone(current_user.phone),
        "optedOut": opted_out,
        "note": (
            "Transactional messages (one-time codes, fine notices, hearing dates) are sent "
            "regardless — they are legal or security communications, not marketing."
        ),
    }


@router.post("/consent/opt-out")
async def opt_out_self(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.phone:
        raise HTTPException(status_code=400, detail="No phone number on this account.")
    await messaging.record_opt_out(db, current_user.phone, source="user_action")
    await db.commit()
    return {"optedOut": True}


@router.post("/consent/opt-in")
async def opt_in_self(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.phone:
        raise HTTPException(status_code=400, detail="No phone number on this account.")
    await messaging.record_opt_in(db, current_user.phone, source="user_action")
    await db.commit()
    return {"optedOut": False}
