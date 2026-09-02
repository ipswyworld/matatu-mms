"""
SMS at production scale: delivery tracking, cost control, consent
(Readiness List §19).

app/sms.py sends a message and hopes. That is adequate for an OTP during a
demo and inadequate for 500k users, for three separate reasons:

  * **Legal delivery.** Some of these messages are fine notices and hearing
    dates. "We sent it" is not the same claim as "it was delivered", and
    only one of those survives a dispute. Fire-and-forget cannot tell them
    apart.

  * **Cost.** SMS is a per-message charge and the largest recurring
    operational cost in a system this size. A notification bug without
    spend tracking is an unbounded spend bug that nobody notices until the
    invoice.

  * **Consent.** Sending to someone who opted out is a regulatory problem,
    and the DPA review in §9 will ask for the records.

This module wraps app/sms.py rather than replacing it: the transport stays
where it is, and everything that must be true *around* a send lives here.
"""
import datetime
import logging
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

logger = logging.getLogger("app.messaging")

# Africa's Talking charges per 160-character segment for GSM-7. A message
# that quietly runs to three segments costs three times what its author
# assumed, so segments are computed and recorded rather than guessed.
GSM7_SEGMENT_CHARS = 160
GSM7_MULTIPART_CHARS = 153  # multipart headers consume 7 characters per part
UNICODE_SEGMENT_CHARS = 70
UNICODE_MULTIPART_CHARS = 67

# Indicative Kenyan per-segment cost. Configurable because it is a
# commercial term, not a constant of nature.
DEFAULT_COST_PER_SEGMENT_KES = Decimal("0.80")

# Categories that ignore an opt-out, because they are not marketing.
#
# A fine notice or a hearing date is a legal communication the county is
# obliged to send; letting someone opt out of those would mean opting out of
# due process. Anything promotional or advisory respects the opt-out
# absolutely.
TRANSACTIONAL_CATEGORIES = {"otp", "fine_notice", "hearing_notice", "account_security"}


def segment_count(message: str) -> tuple[int, bool]:
    """Returns (segments, is_unicode).

    Swahili and English both fit GSM-7, but a single curly quote or emoji
    silently switches the whole message to UCS-2 and more than halves the
    per-segment capacity. Detecting that is the difference between a
    predicted and an actual bill.
    """
    gsm7_extended = set(
        "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
        "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
        "\n\r\f^{}\\[~]|€"
    )
    is_unicode = any(ch not in gsm7_extended for ch in message)

    if is_unicode:
        single, multi = UNICODE_SEGMENT_CHARS, UNICODE_MULTIPART_CHARS
    else:
        single, multi = GSM7_SEGMENT_CHARS, GSM7_MULTIPART_CHARS

    length = len(message)
    if length == 0:
        return 0, is_unicode
    if length <= single:
        return 1, is_unicode
    return -(-length // multi), is_unicode  # ceiling division


def estimate_cost(message: str, cost_per_segment: Optional[Decimal] = None) -> Decimal:
    segments, _ = segment_count(message)
    rate = cost_per_segment or DEFAULT_COST_PER_SEGMENT_KES
    return (Decimal(segments) * rate).quantize(Decimal("0.0001"))


def normalize_phone(phone: str) -> str:
    """Kenyan numbers arrive as 0712…, +254712…, 254712… — all the same
    person. Normalising means one opt-out record covers every form, rather
    than an opt-out that silently fails to match how a later message
    addresses them."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit() or ch == "+")
    digits = digits.lstrip("+")
    if digits.startswith("0"):
        digits = "254" + digits[1:]
    elif digits.startswith("7") or digits.startswith("1"):
        digits = "254" + digits
    return "+" + digits


async def is_opted_out(db: AsyncSession, phone: str) -> bool:
    from app.models import MessagingOptOut

    record = (
        await db.execute(
            select(MessagingOptOut).where(MessagingOptOut.phone == normalize_phone(phone))
        )
    ).scalars().first()
    return record is not None and record.opted_out_at is not None


async def record_opt_out(db: AsyncSession, phone: str, *, source: str = "sms_reply") -> None:
    """Records consent withdrawal. Idempotent — a second STOP is not an error."""
    from app.models import MessagingOptOut

    normalized = normalize_phone(phone)
    existing = (
        await db.execute(select(MessagingOptOut).where(MessagingOptOut.phone == normalized))
    ).scalars().first()
    now = datetime.datetime.now(datetime.timezone.utc)
    if existing:
        existing.opted_out_at = now
        existing.source = source
        existing.opted_in_at = None
    else:
        db.add(MessagingOptOut(phone=normalized, opted_out_at=now, source=source))
    logger.info("Opt-out recorded for %s via %s", normalized, source)


async def record_opt_in(db: AsyncSession, phone: str, *, source: str = "user_action") -> None:
    from app.models import MessagingOptOut

    normalized = normalize_phone(phone)
    existing = (
        await db.execute(select(MessagingOptOut).where(MessagingOptOut.phone == normalized))
    ).scalars().first()
    now = datetime.datetime.now(datetime.timezone.utc)
    if existing:
        existing.opted_out_at = None
        existing.opted_in_at = now
        existing.source = source
    else:
        db.add(MessagingOptOut(phone=normalized, opted_in_at=now, source=source))


async def send_tracked(
    db: AsyncSession,
    *,
    phone: str,
    message: str,
    category: str,
    user_id: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    commit: bool = True,
) -> dict:
    """Sends one SMS, recording cost, consent and outcome.

    Returns a dict describing what happened — including when nothing was
    sent, because "suppressed by opt-out" is an outcome the caller and any
    later audit need to see, not silence.
    """
    from app.models import MessageLog
    from app.sms import send_sms

    normalized = normalize_phone(phone)
    segments, is_unicode = segment_count(message)
    cost = estimate_cost(message)
    log_id = f"msg-{uuid.uuid4().hex[:12]}"

    suppressed = False
    if category not in TRANSACTIONAL_CATEGORIES and await is_opted_out(db, normalized):
        suppressed = True

    status = "SUPPRESSED_OPT_OUT" if suppressed else "SENT"
    error: Optional[str] = None

    if not suppressed:
        try:
            await send_sms(normalized, message)
        except Exception as e:
            # A send failure is recorded, never raised: the caller's own
            # operation (issuing a fine, completing a booking) must not fail
            # because a text message did.
            status = "FAILED"
            error = str(e)[:300]
            logger.warning("SMS to %s failed: %s", normalized, error)

    db.add(MessageLog(
        id=log_id,
        phone=normalized,
        user_id=user_id,
        category=category,
        channel="sms",
        segments=segments,
        is_unicode=is_unicode,
        # Cost is recorded even when suppressed — as zero. A suppressed
        # message is a cost *avoided*, and being able to show that is how
        # opt-out handling justifies itself.
        cost_kes=Decimal("0.0000") if suppressed else cost,
        status=status,
        error=error,
        reference_type=reference_type,
        reference_id=reference_id,
        # The body is deliberately not stored. These carry names, fine
        # amounts and hearing dates; retaining every message indefinitely
        # creates a large pool of personal data with no operational use that
        # the metadata below does not already serve.
        body_preview=(message[:40] + "…") if len(message) > 40 else message,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    ))
    if commit:
        await db.commit()

    return {
        "id": log_id,
        "phone": normalized,
        "status": status,
        "segments": segments,
        "isUnicode": is_unicode,
        "costKes": str(Decimal("0.0000") if suppressed else cost),
        "suppressed": suppressed,
        "error": error,
    }


async def spend_summary(db: AsyncSession, *, days: int = 30) -> dict:
    """What messaging has cost recently, by category.

    Exists so the answer to "why is the SMS bill what it is" is a query
    rather than an investigation.
    """
    from sqlalchemy import func
    from app.models import MessageLog

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    rows = (
        await db.execute(
            select(
                MessageLog.category,
                MessageLog.status,
                func.count(MessageLog.id),
                func.coalesce(func.sum(MessageLog.cost_kes), 0),
                func.coalesce(func.sum(MessageLog.segments), 0),
            )
            .where(MessageLog.created_at >= since)
            .group_by(MessageLog.category, MessageLog.status)
        )
    ).all()

    breakdown = []
    total_cost = Decimal("0")
    total_messages = 0
    for category, status, count, cost, segments in rows:
        cost_dec = Decimal(str(cost or 0))
        total_cost += cost_dec
        total_messages += count
        breakdown.append({
            "category": category,
            "status": status,
            "messages": count,
            "segments": int(segments or 0),
            "costKes": str(cost_dec.quantize(Decimal("0.01"))),
        })

    return {
        "windowDays": days,
        "totalMessages": total_messages,
        "totalCostKes": str(total_cost.quantize(Decimal("0.01"))),
        "breakdown": sorted(breakdown, key=lambda b: b["category"]),
    }
