import datetime
import random
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Fine, Matatu, User
from app.schemas import FineResponse, FineCreate, FineStatusUpdate
from app.auth import get_current_user, requires_permission
from app.events import dispatcher
from app.audit import stage_audit_log

router = APIRouter(prefix="/api/fines", tags=["Fines & Penalties"])

@router.get("", response_model=List[FineResponse])
async def get_fines(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Fine).join(Matatu, Fine.matatu_id == Matatu.id).options(selectinload(Fine.matatu))
    
    # Filter by Sacco if user is Sacco Operator
    if current_user.role == "SACCO_OPERATOR":
        query = query.where(Matatu.sacco_id == current_user.sacco_id)
        
    result = await db.execute(query)
    fines = result.scalars().all()
    
    # Map extra helper fields
    response = []
    for f in fines:
        resp = FineResponse.model_validate(f)
        resp.reg_number = f.matatu.reg_number
        resp.sacco_id = f.matatu.sacco_id
        response.append(resp)
        
    return response

@router.post("", response_model=FineResponse, status_code=status.HTTP_201_CREATED)
async def issue_fine(
    payload: FineCreate,
    current_user: User = Depends(requires_permission("issue_fine")),
    db: AsyncSession = Depends(get_db)
):
    # Verify vehicle exists
    vehicle_result = await db.execute(select(Matatu).where(Matatu.id == payload.matatu_id))
    matatu = vehicle_result.scalars().first()
    if not matatu:
        raise HTTPException(status_code=404, detail="Matatu vehicle not found")
        
    # Generate unique ID
    count_result = await db.execute(select(Fine))
    total_count = len(count_result.scalars().all())
    fine_id = f"f-{1000 + total_count + random.randint(1, 99)}"

    new_fine = Fine(
        id=fine_id,
        matatu_id=payload.matatu_id,
        officer_id=current_user.id,
        reason=payload.reason.strip(),
        amount_kes=payload.amount_kes,
        status="PENDING",
        issued_at=datetime.date.today().isoformat(),
        due_date=payload.due_date
    )
    
    db.add(new_fine)
    stage_audit_log(
        db, resource_type="fine", resource_id=fine_id, action="CREATE",
        user_id=current_user.id,
        new_values={"matatuId": payload.matatu_id, "reason": payload.reason, "amountKes": payload.amount_kes},
    )
    await db.commit()

    # Reload relationship for output mapping
    result = await db.execute(
        select(Fine)
        .options(selectinload(Fine.matatu))
        .where(Fine.id == fine_id)
    )
    fine_obj = result.scalars().first()
    
    # Dispatch event
    dispatcher.dispatch("FINE_ISSUED", {
        "fine": {
            "id": fine_obj.id,
            "matatuId": fine_obj.matatu_id,
            "officerId": fine_obj.officer_id,
            "reason": fine_obj.reason,
            "amountKes": fine_obj.amount_kes,
            "status": fine_obj.status,
            "issuedAt": fine_obj.issued_at,
            "dueDate": fine_obj.due_date
        },
        "sacco_id": matatu.sacco_id,
        "user_id": current_user.id
    })
    
    resp = FineResponse.model_validate(fine_obj)
    resp.reg_number = matatu.reg_number
    resp.sacco_id = matatu.sacco_id
    return resp

@router.patch("/{id}/status", response_model=FineResponse)
async def update_fine_status(
    id: str,
    payload: FineStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Fine)
        .options(selectinload(Fine.matatu))
        .where(Fine.id == id)
    )
    fine = result.scalars().first()
    
    if not fine:
        raise HTTPException(status_code=404, detail="Fine record not found")
        
    old_status = fine.status
    new_status = payload.status.upper().strip()
    
    if new_status not in ["PENDING", "PAID", "DISPUTED", "WAIVED"]:
        raise HTTPException(status_code=400, detail="Invalid status value")
        
    # Check Sacco Operator permission for DISPUTE
    if new_status == "DISPUTED":
        from app.rbac import can
        if not can(current_user.role, "dispute_fine"):
            raise HTTPException(status_code=403, detail="You do not have permission to dispute fines.")
        if current_user.role == "SACCO_OPERATOR" and fine.matatu.sacco_id != current_user.sacco_id:
            raise HTTPException(status_code=403, detail="You can only dispute fines belonging to your Sacco.")
            
    # WAIVED is a policy override: Admin only
    if new_status == "WAIVED":
        from app.rbac import can
        if not can(current_user.role, "update_fine_status"):
            raise HTTPException(status_code=403, detail="Only Admins are permitted to waive fines.")

    # PAID: the owning Sacco pays their own fine (auto, once payment integration lands),
    # or Admin can manually override for edge cases (cash reconciliation, etc.)
    if new_status == "PAID":
        from app.rbac import can
        is_admin_override = can(current_user.role, "update_fine_status")
        is_sacco_payment = can(current_user.role, "pay_fine") and fine.matatu.sacco_id == current_user.sacco_id
        if not (is_admin_override or is_sacco_payment):
            raise HTTPException(status_code=403, detail="You can only pay fines belonging to your own Sacco.")

    if old_status != new_status:
        fine.status = new_status
        stage_audit_log(
            db, resource_type="fine", resource_id=fine.id, action="STATUS_CHANGE",
            user_id=current_user.id, old_values={"status": old_status}, new_values={"status": new_status},
        )
        await db.commit()

        # Dispatch event
        dispatcher.dispatch("FINE_STATUS_CHANGED", {
            "fine_id": fine.id,
            "matatuId": fine.matatu_id,
            "sacco_id": fine.matatu.sacco_id,
            "old_status": old_status,
            "new_status": new_status,
            "user_id": current_user.id
        })
        
    resp = FineResponse.model_validate(fine)
    resp.reg_number = fine.matatu.reg_number
    resp.sacco_id = fine.matatu.sacco_id
    return resp
