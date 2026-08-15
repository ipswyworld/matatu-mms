import random
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import User, Sacco
from app.schemas import UserResponse, UserCreate, UserUpdate
from app.auth import get_current_user, requires_permission, get_password_hash
from app.audit import stage_audit_log
from app.rbac import ADMIN_TIER_ROLES, can
from app.abac import sacco_scope_query

router = APIRouter(prefix="/api/users", tags=["Users Management"])

@router.get("", response_model=List[UserResponse])
async def get_users(
    current_user: User = Depends(requires_permission("view_users")),
    db: AsyncSession = Depends(get_db)
):
    # Was completely unscoped: any account with "view_users" — which
    # includes SACCO_OPERATOR — got back every user in the system, staff
    # and every other Sacco's accounts included, emails and all. Scope a
    # Sacco Operator to their own Sacco's users (their own account plus
    # their Crew) the same way every other list endpoint scopes to
    # sacco_id; unscoped stays correct for the staff/admin roles that
    # actually need full user management.
    query = select(User)
    query = sacco_scope_query(current_user, query, User.sacco_id)
    result = await db.execute(query)
    return result.scalars().all()

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(requires_permission("manage_users")),
    db: AsyncSession = Depends(get_db)
):
    target_role = payload.role.upper().strip()
    if target_role in ADMIN_TIER_ROLES and not can(current_user.role, "manage_admins"):
        raise HTTPException(status_code=403, detail="Only a Super Admin can create an Admin or Super Admin account")

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
    try:
        await db.commit()
    except IntegrityError:
        # Same check-then-insert race as /api/auth/register — the pre-check
        # above is a friendly message, the unique constraint is the real
        # guard against two concurrent admin-creation requests for the same
        # email.
        await db.rollback()
        raise HTTPException(status_code=400, detail="User email already exists")
    await db.refresh(new_user)
    return new_user

@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    current_user: User = Depends(requires_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Admin-tier accounts (ADMIN/SUPERADMIN) can only be edited by a Super
    # Admin — an Admin editing another Admin (or promoting someone into the
    # tier) is exactly the privilege-escalation path this role split exists
    # to close.
    target_becomes_admin_tier = user.role in ADMIN_TIER_ROLES or (payload.role and payload.role.upper().strip() in ADMIN_TIER_ROLES)
    if target_becomes_admin_tier and not can(current_user.role, "manage_admins"):
        raise HTTPException(status_code=403, detail="Only a Super Admin can edit an Admin or Super Admin account")

    old_values = {"name": user.name, "email": user.email, "role": user.role, "saccoId": user.sacco_id}
    new_values = {}

    if payload.email is not None and payload.email.lower().strip() != user.email:
        existing_result = await db.execute(select(User).where(User.email == payload.email.lower().strip()))
        if existing_result.scalars().first():
            raise HTTPException(status_code=400, detail="Another user already has that email")
        user.email = payload.email.lower().strip()
        new_values["email"] = user.email

    if payload.name is not None and payload.name.strip():
        user.name = payload.name.strip()
        new_values["name"] = user.name

    if payload.role is not None:
        role = payload.role.upper().strip()
        if role == "SACCO_OPERATOR" and not (payload.sacco_id or user.sacco_id):
            raise HTTPException(status_code=400, detail="Sacco ID is required for Sacco Operators")
        if user.role == "SUPERADMIN" and role != "SUPERADMIN":
            other_superadmins = await db.execute(select(User).where(User.role == "SUPERADMIN", User.id != user.id))
            if not other_superadmins.scalars().first():
                raise HTTPException(status_code=400, detail="Cannot demote the last remaining Super Admin")
        user.role = role
        new_values["role"] = user.role

    if payload.sacco_id is not None:
        user.sacco_id = payload.sacco_id or None
        new_values["saccoId"] = user.sacco_id

    if payload.new_password:
        if len(payload.new_password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        user.password = get_password_hash(payload.new_password)
        user.reset_token = None
        user.reset_token_expires_at = None
        new_values["passwordReset"] = True

    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="UPDATE",
        user_id=current_user.id, old_values=old_values, new_values=new_values,
    )
    await db.commit()
    await db.refresh(user)
    return user

@router.post("/{user_id}/revoke-sessions", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_sessions(
    user_id: str,
    current_user: User = Depends(requires_permission("manage_users")),
    db: AsyncSession = Depends(get_db),
):
    """Admin-triggered "log this account out everywhere" (§19) — for a
    discovered-compromised account, distinct from a password reset (which
    doesn't invalidate tokens already issued)."""
    from app.session_revocation import revoke_all_sessions
    target = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role in ADMIN_TIER_ROLES and not can(current_user.role, "manage_admins"):
        raise HTTPException(status_code=403, detail="Only a Super Admin can revoke another Admin's sessions")
    await revoke_all_sessions(user_id)
    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="SESSIONS_REVOKED",
        user_id=current_user.id, new_values={"revokedBy": current_user.id},
    )
    await db.commit()
