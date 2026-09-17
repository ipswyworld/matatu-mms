import contextlib
import datetime
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

import json

from app.database import get_db
from app.models import User, Sacco, LoginEvent, AuditLog
from app.schemas import (
    UserResponse, UserCreate, UserUpdate, FavoriteSaccoRequest, UserActivityResponse,
    LoginOverviewResponse, PrivilegedLoginResponse, FailedLoginBurstResponse,
)
from app.auth import get_current_user, requires_permission, get_password_hash
from app.audit import stage_audit_log
from app.rbac import ADMIN_TIER_ROLES, has_permission, ALL_ACTIONS, ALL_ROLES, ENFORCEMENT_ROLES
from app.abac import sacco_scope_query
from app.realtime import get_redis

router = APIRouter(prefix="/api/users", tags=["Users Management"])

FAILED_LOGIN_BURST_WINDOW_MINUTES = 15
FAILED_LOGIN_BURST_THRESHOLD = 3


@router.get("/activity/overview", response_model=LoginOverviewResponse)
async def get_login_overview(
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Cross-account "who's logged in"/anomaly view for the ops console
    (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md A.3/B.2). Gated on
    manage_system_config (SUPERADMIN-only) rather than view_users — this is
    security-monitoring data about privileged accounts, a different
    sensitivity than the ordinary staff roster."""
    # Every LOGIN_SUCCESS for an admin-tier account, oldest first, so the
    # "first time we've seen this IP for this user" check below only has to
    # look backward through what it's already iterated.
    privileged_ids_result = await db.execute(select(User.id, User.name).where(User.role.in_(ADMIN_TIER_ROLES)))
    privileged = {row.id: row.name for row in privileged_ids_result.all()}

    if not privileged:
        recent_privileged_logins: List[PrivilegedLoginResponse] = []
    else:
        events_result = await db.execute(
            select(LoginEvent)
            .where(LoginEvent.event_type == "LOGIN_SUCCESS", LoginEvent.user_id.in_(privileged.keys()))
            .order_by(LoginEvent.created_at.asc())
        )
        events = events_result.scalars().all()

        seen_ips: dict = {}  # user_id -> set of ips already observed
        annotated = []
        for ev in events:
            user_ips = seen_ips.setdefault(ev.user_id, set())
            is_new_ip = bool(ev.ip_address) and ev.ip_address not in user_ips
            if ev.ip_address:
                user_ips.add(ev.ip_address)
            annotated.append((ev, is_new_ip))

        # Most recent first for display, capped to a reasonable feed length.
        recent_privileged_logins = [
            PrivilegedLoginResponse(
                id=ev.id, user_id=ev.user_id, user_name=privileged.get(ev.user_id, ev.user_id),
                ip_address=ev.ip_address, created_at=ev.created_at, is_new_ip=is_new_ip,
            )
            for ev, is_new_ip in reversed(annotated[-50:])
        ]

    # Failed-login bursts: several failures against the same email within a
    # short window — a real, cheap signal for credential-stuffing/guessing,
    # independent of whether that email belongs to a real (or privileged)
    # account.
    window_start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=FAILED_LOGIN_BURST_WINDOW_MINUTES)
    failed_result = await db.execute(
        select(LoginEvent)
        .where(LoginEvent.event_type == "LOGIN_FAILED", LoginEvent.created_at >= window_start)
        .order_by(LoginEvent.created_at.desc())
    )
    failed_events = failed_result.scalars().all()

    by_email: dict = {}
    for ev in failed_events:
        if not ev.email:
            continue
        bucket = by_email.setdefault(ev.email, {"count": 0, "last": ev.created_at})
        bucket["count"] += 1
        if ev.created_at > bucket["last"]:
            bucket["last"] = ev.created_at

    failed_login_bursts = [
        FailedLoginBurstResponse(email=email, count=b["count"], last_attempt_at=b["last"])
        for email, b in by_email.items()
        if b["count"] >= FAILED_LOGIN_BURST_THRESHOLD
    ]
    failed_login_bursts.sort(key=lambda b: b.count, reverse=True)

    return LoginOverviewResponse(recent_privileged_logins=recent_privileged_logins, failed_login_bursts=failed_login_bursts)


@router.patch("/me/favorite-sacco", response_model=UserResponse)
async def set_favorite_sacco(
    payload: FavoriteSaccoRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Self-service only — a passenger's own preferred operator, not
    something an admin/operator sets on someone else's account."""
    if payload.sacco_id:
        sacco_result = await db.execute(select(Sacco).where(Sacco.id == payload.sacco_id))
        if not sacco_result.scalars().first():
            raise HTTPException(status_code=404, detail="Operator not found")
    current_user.favorite_sacco_id = payload.sacco_id
    await db.commit()
    await db.refresh(current_user)
    return current_user

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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Two doors into the same endpoint: full manage_users (any role) or the
    # narrower add_officer grant an ENFORCEMENT_COMMANDER holds — a
    # commander bringing on a new officer from the paper sheet, not a
    # general admin provisioning any account type.
    can_manage_users = has_permission(current_user, "manage_users")
    can_add_officer = has_permission(current_user, "add_officer")
    if not (can_manage_users or can_add_officer):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action: manage_users",
        )

    target_role = payload.role.upper().strip()
    if not can_manage_users:
        # add_officer alone cannot be used to mint any other account type,
        # even by editing the request body — enforced server-side.
        if target_role not in ENFORCEMENT_ROLES:
            raise HTTPException(status_code=403, detail="You can only add officers to an enforcement role.")
    if target_role in ADMIN_TIER_ROLES and not has_permission(current_user, "manage_admins"):
        raise HTTPException(status_code=403, detail="Only a Super Admin can create an Admin or Super Admin account")

    user_id = f"u-{uuid.uuid4().hex[:8]}"

    # An officer brought in from the sheet often has no email on file yet —
    # same placeholder pattern as phone-only self-registration
    # (routes/auth.py's register()), so User.email's NOT NULL/unique
    # constraint never sees the gap.
    email = payload.email.lower().strip() if payload.email else f"{user_id}@officer.matatu-mms.internal"

    # Verify email uniqueness
    existing_result = await db.execute(select(User).where(User.email == email))
    if existing_result.scalars().first():
        raise HTTPException(status_code=400, detail="User email already exists")

    # If Sacco Operator, verify Sacco ID
    if payload.role == "SACCO_OPERATOR":
        if not payload.sacco_id:
            raise HTTPException(status_code=400, detail="Sacco ID is required for Sacco Operators")
        sacco_result = await db.execute(select(Sacco).where(Sacco.id == payload.sacco_id))
        if not sacco_result.scalars().first():
            raise HTTPException(status_code=400, detail="Invalid Sacco ID")

    new_user = User(
        id=user_id,
        name=payload.name.strip(),
        email=email,
        phone=payload.phone.strip() if payload.phone else None,
        password=await get_password_hash(payload.password),
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
    if target_becomes_admin_tier and not has_permission(current_user, "manage_admins"):
        raise HTTPException(status_code=403, detail="Only a Super Admin can edit an Admin or Super Admin account")

    old_values = {"name": user.name, "email": user.email, "role": user.role, "saccoId": user.sacco_id}
    new_values = {}

    # "Last Super Admin standing" is a table-wide invariant, not a per-row
    # check — two concurrent requests demoting/deactivating two *different*
    # Super Admins (the only two left) could each see "the other one is
    # still here" before either commits, and both succeed, leaving zero.
    # That's an unrecoverable lockout short of direct DB access, so this
    # section (not just this one row's own uniqueness checks) needs to run
    # under a lock whenever the target is currently a Super Admin.
    redis = await get_redis()
    lock_cm = (
        redis.lock("superadmin_lockout_guard", timeout=10, blocking_timeout=10)
        if user.role == "SUPERADMIN"
        else contextlib.nullcontext()
    )
    async with lock_cm:
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
            user.password = await get_password_hash(payload.new_password)
            user.reset_token = None
            user.reset_token_expires_at = None
            new_values["passwordReset"] = True
            # An admin-forced reset should also end whatever session the old
            # password was still authenticating (e.g. a compromised account
            # being locked out from under an active attacker).
            from app.session_revocation import revoke_all_sessions
            await revoke_all_sessions(user.id)

        if payload.extra_permissions is not None:
            # Only a Super Admin grants individual extra permissions — an Admin
            # doing this would be an end-run around the ADMIN_TIER_ROLES-editing
            # restriction above (grant yourself manage_admins one action at a
            # time instead of just assigning yourself the SUPERADMIN role).
            if not has_permission(current_user, "manage_admins"):
                raise HTTPException(status_code=403, detail="Only a Super Admin can grant individual extra permissions")
            invalid = [a for a in payload.extra_permissions if a not in ALL_ACTIONS]
            if invalid:
                raise HTTPException(status_code=400, detail=f"Unknown permission(s): {', '.join(invalid)}")
            user.extra_permissions = json.dumps(payload.extra_permissions) if payload.extra_permissions else None
            new_values["extraPermissions"] = payload.extra_permissions

        if payload.additional_roles is not None:
            invalid_roles = [r for r in payload.additional_roles if r not in ALL_ROLES]
            if invalid_roles:
                raise HTTPException(status_code=400, detail=f"Unknown role(s): {', '.join(invalid_roles)}")
            # Granting an admin-tier role here is exactly as sensitive as
            # granting manage_admins via extra_permissions above — same guard,
            # so an Admin can't hand themselves SUPERADMIN's bundle by adding it
            # as an "additional role" instead of changing their primary role.
            if set(payload.additional_roles) & ADMIN_TIER_ROLES and not has_permission(current_user, "manage_admins"):
                raise HTTPException(status_code=403, detail="Only a Super Admin can grant an admin-tier additional role")
            user.additional_roles = json.dumps(payload.additional_roles) if payload.additional_roles else None
            new_values["additionalRoles"] = payload.additional_roles

        if payload.is_active is not None:
            if payload.is_active is False:
                if user.id == current_user.id:
                    raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")
                if user.role == "SUPERADMIN":
                    other_active_superadmins = await db.execute(
                        select(User).where(User.role == "SUPERADMIN", User.id != user.id, User.is_active != False)
                    )
                    if not other_active_superadmins.scalars().first():
                        raise HTTPException(status_code=400, detail="Cannot deactivate the last active Super Admin")
            user.is_active = payload.is_active
            new_values["isActive"] = user.is_active

        stage_audit_log(
            db, resource_type="user", resource_id=user_id, action="UPDATE",
            user_id=current_user.id, old_values=old_values, new_values=new_values,
        )
        try:
            await db.commit()
        except IntegrityError:
            # Same check-then-set race as everywhere else in this file — the
            # email-uniqueness check above is a friendly message, not the
            # real guard against two concurrent edits landing on the same
            # new email.
            await db.rollback()
            raise HTTPException(status_code=400, detail="Another user already has that email")
    await db.refresh(user)
    return user

@router.get("/{user_id}/activity", response_model=UserActivityResponse)
async def get_user_activity(
    user_id: str,
    current_user: User = Depends(requires_permission("view_users")),
    db: AsyncSession = Depends(get_db),
):
    """Per-user Activity tab (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md Part
    B.2): this account's login history (LoginEvent, added alongside the
    auth.py instrumentation) plus its own AuditLog rows — what has this
    person actually done, composed on one screen. Same admin-tier guard as
    revoke_user_sessions below: viewing another Admin/Super Admin's
    activity is exactly as sensitive as revoking their sessions."""
    target = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role in ADMIN_TIER_ROLES and not has_permission(current_user, "manage_admins"):
        raise HTTPException(status_code=403, detail="Only a Super Admin can view another Admin's activity")

    login_events = (
        await db.execute(
            select(LoginEvent).where(LoginEvent.user_id == user_id).order_by(LoginEvent.created_at.desc()).limit(50)
        )
    ).scalars().all()
    audit_logs = (
        await db.execute(
            select(AuditLog).where(AuditLog.user_id == user_id).order_by(AuditLog.timestamp.desc()).limit(50)
        )
    ).scalars().all()
    return UserActivityResponse(login_events=login_events, audit_logs=audit_logs)


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
    if target.role in ADMIN_TIER_ROLES and not has_permission(current_user, "manage_admins"):
        raise HTTPException(status_code=403, detail="Only a Super Admin can revoke another Admin's sessions")
    await revoke_all_sessions(user_id)
    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="SESSIONS_REVOKED",
        user_id=current_user.id, new_values={"revokedBy": current_user.id},
    )
    await db.commit()
