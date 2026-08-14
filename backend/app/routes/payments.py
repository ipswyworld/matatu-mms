import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from app.database import get_db
from app.models import Fine
from app.events import dispatcher
from app.audit import stage_audit_log
from app.config import NAIROBIPAY_CALLBACK_SECRET

logger = logging.getLogger("app.routes.payments")
router = APIRouter(prefix="/api/payments", tags=["NairobiPay Payments Integration"])

class NairobiPayCallbackPayload(BaseModel):
    transaction_type: str
    transaction_id: str
    transaction_time: str
    amount: str
    reference: str  # This corresponds to the Fine ID, e.g., "f-1"
    payer_phone: str
    payer_name: str

@router.post("/nairobipay-callback/{callback_token}")
async def nairobipay_payment_callback(
    callback_token: str,
    payload: NairobiPayCallbackPayload,
    db: AsyncSession = Depends(get_db)
):
    """
    Simulates NairobiPay's payment confirmation callback (NairobiPay's real
    API isn't available yet — this stands in for it with the same shape
    a real integration would have). Automatically marks the matched fine as
    PAID and fires status update events.

    NairobiPay doesn't sign callback payloads, so `callback_token` — a secret
    known only to this server and the NairobiPay gateway configuration — is
    the actual authentication here. Register the callback URL with this
    exact token in its path; anyone else gets a 404 indistinguishable from a
    wrong URL, not a fine marked paid.
    """
    if not hmac.compare_digest(callback_token, NAIROBIPAY_CALLBACK_SECRET):
        logger.warning("Rejected NairobiPay callback with an invalid callback token.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    fine_id = payload.reference.strip()
    amount_paid = float(payload.amount)

    result = await db.execute(
        select(Fine)
        .options(selectinload(Fine.matatu))
        .where(Fine.id == fine_id)
    )
    fine = result.scalars().first()

    if not fine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fine {fine_id} not found."
        )

    # Check if already paid
    if fine.status == "PAID":
        return {"resultCode": 0, "resultDesc": "Already processed: fine already paid."}

    # Verify amount matches (within minor margin for float differences)
    if abs(fine.amount_kes - amount_paid) > 0.01:
        return {
            "resultCode": 1,
            "resultDesc": f"Rejected: Expected KES {fine.amount_kes}, got KES {amount_paid}"
        }

    old_status = fine.status
    fine.status = "PAID"
    stage_audit_log(
        db, resource_type="fine", resource_id=fine.id, action="NAIROBIPAY_PAYMENT",
        user_id="NAIROBIPAY_SYSTEM",
        old_values={"status": old_status},
        new_values={"status": "PAID", "transactionId": payload.transaction_id, "amount": amount_paid},
    )
    await db.commit()

    # Dispatch status change event
    dispatcher.dispatch("FINE_STATUS_CHANGED", {
        "fine_id": fine.id,
        "matatuId": fine.matatu_id,
        "sacco_id": fine.matatu.sacco_id,
        "old_status": old_status,
        "new_status": "PAID",
        "user_id": "NAIROBIPAY_SYSTEM",
        "paymentDetails": {
            "transactionId": payload.transaction_id,
            "phone": payload.payer_phone,
            "name": payload.payer_name,
            "time": payload.transaction_time
        }
    })

    return {
        "resultCode": 0,
        "resultDesc": f"Confirmation accepted. Fine {fine.id} marked as PAID."
    }
