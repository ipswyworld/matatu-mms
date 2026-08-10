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
from app.config import MPESA_CALLBACK_SECRET

logger = logging.getLogger("app.routes.payments")
router = APIRouter(prefix="/api/payments", tags=["M-Pesa Payments Integrations"])

class MpesaCallbackPayload(BaseModel):
    transaction_type: str
    trans_id: str
    trans_time: str
    trans_amount: str
    business_short_code: str
    bill_ref_number: str  # This corresponds to the Fine ID, e.g., "f-1"
    msisdn: str
    first_name: str
    middle_name: str

@router.post("/mpesa-callback/{callback_token}")
async def mpesa_payment_callback(
    callback_token: str,
    payload: MpesaCallbackPayload,
    db: AsyncSession = Depends(get_db)
):
    """
    Simulates Safaricom M-Pesa Paybill validation & confirmation callback.
    Automatically marks the matched fine as PAID and fires status update events.

    Daraja doesn't sign callback payloads, so `callback_token` — a secret
    known only to this server and the Daraja app configuration — is the
    actual authentication here. Register the callback URL with this exact
    token in its path; anyone else gets a 404 indistinguishable from a
    wrong URL, not a fine marked paid.
    """
    if not hmac.compare_digest(callback_token, MPESA_CALLBACK_SECRET):
        logger.warning("Rejected M-Pesa callback with an invalid callback token.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    fine_id = payload.bill_ref_number.strip()
    amount_paid = float(payload.trans_amount)

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
        return {"ResultCode": 0, "ResultDesc": "Already processed: fine already paid."}

    # Verify amount matches (within minor margin for float differences)
    if abs(fine.amount_kes - amount_paid) > 0.01:
        return {
            "ResultCode": 1,
            "ResultDesc": f"Rejected: Expected KES {fine.amount_kes}, got KES {amount_paid}"
        }

    old_status = fine.status
    fine.status = "PAID"
    stage_audit_log(
        db, resource_type="fine", resource_id=fine.id, action="MPESA_PAYMENT",
        user_id="MPESA_SYSTEM",
        old_values={"status": old_status},
        new_values={"status": "PAID", "transactionId": payload.trans_id, "amount": amount_paid},
    )
    await db.commit()

    # Dispatch status change event
    dispatcher.dispatch("FINE_STATUS_CHANGED", {
        "fine_id": fine.id,
        "matatuId": fine.matatu_id,
        "sacco_id": fine.matatu.sacco_id,
        "old_status": old_status,
        "new_status": "PAID",
        "user_id": "MPESA_SYSTEM",
        "paymentDetails": {
            "transactionId": payload.trans_id,
            "phone": payload.msisdn,
            "name": f"{payload.first_name} {payload.middle_name}".strip(),
            "time": payload.trans_time
        }
    })

    return {
        "ResultCode": 0,
        "ResultDesc": f"Confirmation accepted. Fine {fine.id} marked as PAID."
    }
