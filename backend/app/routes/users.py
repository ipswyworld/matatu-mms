import random
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import User, Sacco
from app.schemas import UserResponse, UserCreate
from app.auth import get_current_user, requires_permission, get_password_hash
from app.audit import stage_audit_log

router = APIRouter(prefix="/api/users", tags=["Users Management"])

@router.get("", response_model=List[UserResponse])
async def get_users(
    current_user: User = Depends(requires_permission("view_users")),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User))
    return result.scalars().all()

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(requires_permission("manage_users")),
    db: AsyncSession = Depends(get_db)
):
    # Verify email uniqueness
    existing_result = await db.execute(select(User).where(User.email == payload.email.lower().strip()))
    if existing_result.scalars().first():
        raise HTTPException(status_code=400, detail="User email already exists")

    # If Sacco Operator, verify Sacco ID
    if payload.role == "SACCO_OPERATOR":
        if not payload.sacco_id:
            raise HTTPException(status_code=400, detail="Sacco ID is required for Sacco Operators")
        sacco_result = await db.execute(select(Sacco).where(Sacco.id == payload.sacco_id))
        if not sacco_result.scalars().first():
            raise HTTPException(status_code=400, detail="Invalid Sacco ID")

    # Generate incremental/unique ID
    count_result = await db.execute(select(User))
    total_count = len(count_result.scalars().all())
    user_id = f"u-{1000 + total_count + random.randint(1, 99)}"

    new_user = User(
        id=user_id,
        name=payload.name.strip(),
        email=payload.email.lower().strip(),
        password=get_password_hash(payload.password),
        role=payload.role.upper().strip(),
        sacco_id=payload.sacco_id if payload.role == "SACCO_OPERATOR" else None
    )
    
    db.add(new_user)
    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="CREATE",
        user_id=current_user.id,
        new_values={"name": new_user.name, "email": new_user.email, "role": new_user.role, "saccoId": new_user.sacco_id},
    )
    await db.commit()
    await db.refresh(new_user)
    return new_user
