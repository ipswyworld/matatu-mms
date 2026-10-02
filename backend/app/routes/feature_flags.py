import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import User, FeatureFlag
from app.schemas import FeatureFlagResponse, FeatureFlagCreate, FeatureFlagUpdate
from app.auth import requires_permission, get_current_user
from app.audit import stage_audit_log

router = APIRouter(prefix="/api/feature-flags", tags=["Feature Flags"])


@router.get("/{key}/enabled")
async def check_feature_flag(
    key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Any authenticated user can check one flag's state — deliberately not
    gated behind manage_system_config like the CRUD routes above, since a
    call site (e.g. the staff app's RoleMatrix panel) needs to know whether
    a flag is on, not manage flags. Missing key reads as "not enabled"
    rather than 404, so a call site never has to special-case "flag doesn't
    exist yet" separately from "flag exists and is off"."""
    return {"key": key, "enabled": await is_feature_enabled(db, key)}


@router.get("", response_model=List[FeatureFlagResponse])
async def list_feature_flags(
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    """Ops console Tier-1 config CRUD (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md
    A.2) — manage_system_config is SUPERADMIN-only in ROLE_MATRIX, matching
    this console's own SUPERADMIN-only access."""
    result = await db.execute(select(FeatureFlag).order_by(FeatureFlag.key))
    return result.scalars().all()


@router.post("", response_model=FeatureFlagResponse, status_code=status.HTTP_201_CREATED)
async def create_feature_flag(
    payload: FeatureFlagCreate,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(select(FeatureFlag).where(FeatureFlag.key == payload.key))).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail=f"A flag named '{payload.key}' already exists")

    flag = FeatureFlag(
        key=payload.key,
        description=payload.description,
        enabled=payload.enabled,
        updated_by=current_user.id,
        updated_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(flag)
    stage_audit_log(
        db, resource_type="feature_flag", resource_id=payload.key, action="CREATE",
        user_id=current_user.id, new_values={"description": payload.description, "enabled": payload.enabled},
    )
    await db.commit()
    await db.refresh(flag)
    return flag


@router.patch("/{key}", response_model=FeatureFlagResponse)
async def update_feature_flag(
    key: str,
    payload: FeatureFlagUpdate,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    flag = (await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))).scalars().first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")

    old_values = {"description": flag.description, "enabled": flag.enabled}
    provided = payload.model_dump(exclude_unset=True)
    if payload.description is not None:
        flag.description = payload.description
    if payload.enabled is not None:
        flag.enabled = payload.enabled
    # Explicit null clears a schedule; the field must be present in the
    # request at all to be touched (see FeatureFlagUpdate's docstring) —
    # otherwise an ordinary description/enabled edit would silently wipe
    # any pending schedule it never meant to touch.
    if "scheduled_enable_at" in provided:
        flag.scheduled_enable_at = payload.scheduled_enable_at
    if "scheduled_disable_at" in provided:
        flag.scheduled_disable_at = payload.scheduled_disable_at
    flag.updated_by = current_user.id
    flag.updated_at = datetime.datetime.now(datetime.timezone.utc)

    stage_audit_log(
        db, resource_type="feature_flag", resource_id=key, action="UPDATE",
        user_id=current_user.id, old_values=old_values,
        new_values={"description": flag.description, "enabled": flag.enabled},
    )
    await db.commit()
    await db.refresh(flag)
    return flag


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feature_flag(
    key: str,
    current_user: User = Depends(requires_permission("manage_system_config")),
    db: AsyncSession = Depends(get_db),
):
    flag = (await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))).scalars().first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")

    stage_audit_log(
        db, resource_type="feature_flag", resource_id=key, action="DELETE",
        user_id=current_user.id, old_values={"description": flag.description, "enabled": flag.enabled},
    )
    await db.delete(flag)
    await db.commit()


async def is_feature_enabled(db: AsyncSession, key: str) -> bool:
    """The actual utility future call sites use — not wired into any
    behavior yet (this is the first flag-consuming feature in the
    codebase), but this is the real function they'll call, not a stub."""
    flag = (await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))).scalars().first()
    return bool(flag and flag.enabled)
