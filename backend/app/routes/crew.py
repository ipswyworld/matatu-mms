import datetime
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import CrewAssignment, Matatu, User
from app.schemas import CrewIssueRequest, CrewIssueResponse, CrewAssignmentResponse, CrewAlertRequest
from app.auth import get_current_user, requires_permission, get_password_hash
from app.audit import stage_audit_log
from app.abac import sacco_scope_query, enforce_own_sacco
from app.routes.notifications import notify_user

router = APIRouter(prefix="/api/crew", tags=["Crew"])


def _to_response(assignment: CrewAssignment) -> CrewAssignmentResponse:
    return CrewAssignmentResponse(
        id=assignment.id,
        user_id=assignment.user_id,
        matatu_id=assignment.matatu_id,
        crew_role=assignment.crew_role,
        assigned_at=assignment.assigned_at,
        unassigned_at=assignment.unassigned_at,
        user_name=assignment.user.name,
        user_email=assignment.user.email,
        matatu_reg_number=assignment.matatu.reg_number,
    )


@router.get("", response_model=List[CrewAssignmentResponse])
async def list_crew(
    active_only: bool = Query(True),
    current_user: User = Depends(requires_permission("view_crew")),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(CrewAssignment)
        .join(Matatu, CrewAssignment.matatu_id == Matatu.id)
        .options(selectinload(CrewAssignment.user), selectinload(CrewAssignment.matatu))
    )
    query = sacco_scope_query(current_user, query, Matatu.sacco_id)
    if active_only:
        query = query.where(CrewAssignment.unassigned_at.is_(None))
    result = await db.execute(query.order_by(CrewAssignment.assigned_at.desc()))
    return [_to_response(a) for a in result.scalars().all()]


@router.post("", response_model=CrewIssueResponse, status_code=status.HTTP_201_CREATED)
async def issue_crew_credentials(
    payload: CrewIssueRequest,
    current_user: User = Depends(requires_permission("manage_crew")),
    db: AsyncSession = Depends(get_db),
):
    matatu_result = await db.execute(select(Matatu).where(Matatu.id == payload.matatu_id))
    matatu = matatu_result.scalars().first()
    if not matatu:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    # Operators (and CREW, defensively) may only issue credentials for their
    # own Sacco's vehicles — Admin/Superadmin oversight is unrestricted.
    enforce_own_sacco(current_user, matatu.sacco_id, "You can only assign crew to your own Sacco's vehicles.")

    existing_result = await db.execute(select(User).where(User.email == payload.email))
    if existing_result.scalars().first():
        raise HTTPException(status_code=400, detail="A user with that email already exists")

    generated_password = secrets.token_urlsafe(9)
    now = datetime.datetime.now(datetime.timezone.utc)
    user_id = f"crew-{secrets.token_hex(4)}"
    assignment_id = f"ca-{secrets.token_hex(4)}"

    new_user = User(
        id=user_id,
        name=payload.name.strip(),
        email=payload.email,
        password=await get_password_hash(generated_password),
        role="CREW",
        sacco_id=matatu.sacco_id,
    )
    db.add(new_user)

    assignment = CrewAssignment(
        id=assignment_id,
        user_id=user_id,
        matatu_id=payload.matatu_id,
        crew_role=payload.crew_role,
        assigned_at=now,
    )
    db.add(assignment)

    stage_audit_log(
        db, resource_type="crew_assignment", resource_id=assignment_id, action="CREATE",
        user_id=current_user.id,
        new_values={
            "crewUserId": user_id, "crewName": new_user.name, "crewEmail": new_user.email,
            "matatuId": payload.matatu_id, "crewRole": payload.crew_role,
        },
    )

    try:
        await db.commit()
    except IntegrityError:
        # Same check-then-insert race guarded elsewhere (auth.py register,
        # users.py create_user) — the pre-check above is the friendly
        # message, the unique constraint on User.email is the real guard.
        await db.rollback()
        raise HTTPException(status_code=400, detail="A user with that email already exists")

    await db.refresh(assignment, attribute_names=["user", "matatu"])
    return CrewIssueResponse(assignment=_to_response(assignment), generated_password=generated_password)


@router.patch("/{assignment_id}/revoke", response_model=CrewAssignmentResponse)
async def revoke_crew_assignment(
    assignment_id: str,
    current_user: User = Depends(requires_permission("manage_crew")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CrewAssignment)
        .where(CrewAssignment.id == assignment_id)
        .options(selectinload(CrewAssignment.user), selectinload(CrewAssignment.matatu))
    )
    assignment = result.scalars().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Crew assignment not found")
    enforce_own_sacco(current_user, assignment.matatu.sacco_id, "You can only manage your own Sacco's crew assignments.")

    if assignment.unassigned_at is not None:
        raise HTTPException(status_code=400, detail="This crew assignment is already revoked")

    old_values = {"unassignedAt": None}
    assignment.unassigned_at = datetime.datetime.now(datetime.timezone.utc)
    stage_audit_log(
        db, resource_type="crew_assignment", resource_id=assignment_id, action="UPDATE",
        user_id=current_user.id, old_values=old_values,
        new_values={"unassignedAt": assignment.unassigned_at.isoformat()},
    )
    await db.commit()
    await db.refresh(assignment, attribute_names=["user", "matatu"])
    return _to_response(assignment)


@router.patch("/user/{user_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def remove_crew_member(
    user_id: str,
    current_user: User = Depends(requires_permission("manage_crew")),
    db: AsyncSession = Depends(get_db),
):
    """Fully removes a crew member — deactivates their login (blocks it
    immediately, same as users.py's admin-side deactivate) and ends every
    active vehicle assignment. Distinct from revoke_crew_assignment above,
    which only unassigns one vehicle so the crew's account and other
    assignments are untouched — this is for "this person no longer works
    for us at all," not "moving them to a different vehicle."
    """
    result = await db.execute(select(User).where(User.id == user_id, User.role == "CREW"))
    crew_user = result.scalars().first()
    if not crew_user:
        raise HTTPException(status_code=404, detail="Crew member not found")
    enforce_own_sacco(current_user, crew_user.sacco_id, "You can only manage your own Sacco's crew.")

    crew_user.is_active = False

    assignments_result = await db.execute(
        select(CrewAssignment).where(CrewAssignment.user_id == user_id, CrewAssignment.unassigned_at.is_(None))
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    for assignment in assignments_result.scalars().all():
        assignment.unassigned_at = now

    stage_audit_log(
        db, resource_type="user", resource_id=user_id, action="UPDATE",
        user_id=current_user.id, old_values={"isActive": True}, new_values={"isActive": False},
    )
    await db.commit()


@router.post("/alert", status_code=status.HTTP_200_OK)
async def alert_crew(
    payload: CrewAlertRequest,
    current_user: User = Depends(requires_permission("manage_crew")),
    db: AsyncSession = Depends(get_db),
):
    """The other direction of crew.tsx's "Send Rapid Incident Alert" — an
    operator (or admin) pushing a message TO their crew, e.g. "route
    diversion on Waiyaki Way" or "return to depot". Delivered the same way
    every other live notification is (routes/notifications.py's
    notify_user over the already-open NotificationBell WebSocket each
    crew member's session holds) — no new delivery channel needed, crew
    accounts already receive these, nobody was just sending them one."""
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Write a message to send.")

    query = (
        select(CrewAssignment)
        .join(Matatu, CrewAssignment.matatu_id == Matatu.id)
        .where(CrewAssignment.unassigned_at.is_(None))
        .options(selectinload(CrewAssignment.user), selectinload(CrewAssignment.matatu))
    )
    query = sacco_scope_query(current_user, query, Matatu.sacco_id)
    if payload.matatu_id:
        query = query.where(CrewAssignment.matatu_id == payload.matatu_id)

    result = await db.execute(query)
    assignments = result.scalars().all()
    if not assignments:
        raise HTTPException(status_code=404, detail="No active crew found to alert.")

    notified_user_ids = set()
    for assignment in assignments:
        if assignment.user_id in notified_user_ids:
            continue
        notified_user_ids.add(assignment.user_id)
        await notify_user(
            assignment.user_id, title="Alert from your operator",
            message=message, level="warning",
        )

    return {"notified": len(notified_user_ids)}
