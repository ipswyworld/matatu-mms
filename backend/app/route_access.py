"""Shared "does this operator actually run this route" check — routes are
shared, county-wide entities (not Sacco-owned), so an operator's access to
manage anything scoped to a route is derived from their own fleet rather
than a direct FK. Originally lived only in app/routes/fare_stages.py;
extracted here once app/routes/operator_terminals.py needed the identical
check.
"""
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Matatu, Route, User


async def enforce_route_access(db: AsyncSession, current_user: User, route: Route) -> None:
    """Admin/Superadmin manage any route. A Sacco Operator (or Crew) may
    only act on a route at least one of their own vehicles operates on."""
    if current_user.role not in ("SACCO_OPERATOR", "CREW"):
        return
    result = await db.execute(
        select(Matatu).where(Matatu.route_id == route.id, Matatu.sacco_id == current_user.sacco_id)
    )
    if not result.scalars().first():
        raise HTTPException(
            status_code=403,
            detail="You can only manage data for routes your own fleet operates on.",
        )
