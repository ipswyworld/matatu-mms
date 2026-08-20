import logging

import httpx

from app.config import AFRICASTALKING_API_KEY, AFRICASTALKING_USERNAME, SMS_SENDER_ID

logger = logging.getLogger("app.sms")

AFRICASTALKING_SEND_URL = "https://api.africastalking.com/version1/messaging"


async def send_sms(phone: str, message: str) -> None:
    """
    Sends an SMS via Africa's Talking (the standard Kenyan SMS gateway) when
    credentials are configured. No real provider is wired in for this
    deployment yet — same situation as NairobiPay's real API — so this logs
    the message server-side instead of silently dropping it, exactly like
    the email password-reset link does in routes/auth.py.

    Best-effort: an SMS delivery failure must never break the OTP flow
    itself (the OTP is already persisted before this is called) — the user
    just doesn't get the text and has to request a new one.
    """
    if not AFRICASTALKING_USERNAME or not AFRICASTALKING_API_KEY:
        logger.warning("SMS to %s (no provider configured, not sent): %s", phone, message)
        return

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            payload = {"username": AFRICASTALKING_USERNAME, "to": phone, "message": message}
            if SMS_SENDER_ID:
                payload["from"] = SMS_SENDER_ID
            response = await client.post(
                AFRICASTALKING_SEND_URL,
                data=payload,
                headers={
                    "apiKey": AFRICASTALKING_API_KEY,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()
    except Exception:
        logger.exception("Failed to send SMS to %s via Africa's Talking", phone)
