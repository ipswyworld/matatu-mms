"""
Full-text search across staff-facing records (Readiness List §18).

`ILIKE '%term%'` cannot use an index: every query scans the whole table, so
search degrades linearly and becomes unusable somewhere in the low hundreds
of thousands of rows — which this system will pass on fines alone.

Postgres full-text with a GIN index handles that, and handles what staff
actually type: multi-word queries with stemming ("unpaid speeding fines"
matching "speed" and "fine"), rather than a literal substring.

SQLite has no equivalent, so the dev fallback is ILIKE. That is correct
there — dev data is small — and the divergence is contained to one function
rather than leaking into every call site.

Results are scoped by the caller's ABAC rules exactly like every other
read. Search is a very easy place to accidentally bypass tenancy: it
touches many tables at once and the filters are easy to forget, so scoping
happens in one place here rather than per-entity.
"""
import logging
from typing import List, Optional

from sqlalchemy import Float, String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import abac
from app.database import IS_SQLITE

logger = logging.getLogger("app.fulltext")

MAX_RESULTS_PER_TYPE = 25


def _tsquery(term: str):
    """websearch_to_tsquery handles quoted phrases and OR the way a user
    expects, and — critically — never raises on malformed input. Plain
    to_tsquery throws a syntax error on a stray operator, which would turn
    a typo into a 500."""
    return func.websearch_to_tsquery("english", term)


def _matches(columns, term: str):
    """Search predicate for the current dialect."""
    combined = None
    for col in columns:
        piece = func.coalesce(cast(col, String), "")
        combined = piece if combined is None else (combined + " " + piece)

    if IS_SQLITE:
        # Dev fallback. Correct, just not scalable — which is fine for the
        # data volumes SQLite is used at here.
        return or_(*[cast(col, String).ilike(f"%{term}%") for col in columns])

    return func.to_tsvector("english", combined).op("@@")(_tsquery(term))


async def search_all(
    db: AsyncSession, *, principal, term: str, limit: int = MAX_RESULTS_PER_TYPE
) -> dict:
    """Cross-entity search, scoped to what the caller may see."""
    from app.models import Fine, Matatu, Sacco, User

    term = (term or "").strip()
    if len(term) < 2:
        return {"query": term, "results": {}, "note": "Enter at least two characters."}

    results: dict = {}

    # --- Vehicles ---------------------------------------------------------
    vehicle_q = select(Matatu).where(_matches([Matatu.reg_number, Matatu.id], term))
    vehicle_q = abac.sacco_scope_query(principal, vehicle_q, Matatu.sacco_id)
    vehicles = (await db.execute(vehicle_q.limit(limit))).scalars().all()
    results["vehicles"] = [
        {"id": m.id, "registration": m.reg_number, "status": m.status, "saccoId": m.sacco_id}
        for m in vehicles
    ]

    # --- Fines ------------------------------------------------------------
    # Scoped through the vehicle, since a Fine has no sacco_id of its own.
    fine_q = (
        select(Fine)
        .join(Matatu, Fine.matatu_id == Matatu.id)
        .where(_matches([Fine.reason, Fine.id], term))
    )
    fine_q = abac.sacco_scope_query(principal, fine_q, Matatu.sacco_id)
    fines = (await db.execute(fine_q.limit(limit))).scalars().all()
    results["fines"] = [
        {
            "id": f.id,
            "matatuId": f.matatu_id,
            "reason": f.reason,
            "status": f.status,
            "amountKes": str(f.amount_kes),
        }
        for f in fines
    ]

    # --- Saccos and users: staff-only ------------------------------------
    #
    # A Sacco operator searching must not be able to enumerate other Saccos
    # or the county's user directory. Rather than filtering those result
    # sets, they are omitted entirely for scoped roles — an empty section is
    # unambiguous, whereas a filtered one invites "why did that return
    # nothing" and tempts a future change to loosen the filter.
    role = getattr(principal, "role", None)
    if role not in ("SACCO_OPERATOR", "CREW", "PASSENGER"):
        saccos = (
            await db.execute(
                select(Sacco).where(_matches([Sacco.name, Sacco.id], term)).limit(limit)
            )
        ).scalars().all()
        results["saccos"] = [{"id": s.id, "name": s.name, "status": s.status} for s in saccos]

        users = (
            await db.execute(
                select(User).where(_matches([User.name, User.email], term)).limit(limit)
            )
        ).scalars().all()
        results["users"] = [
            {"id": u.id, "name": u.name, "role": u.role, "saccoId": u.sacco_id} for u in users
        ]

    return {
        "query": term,
        "engine": "ilike (sqlite dev)" if IS_SQLITE else "postgres full-text",
        "results": results,
        "totalMatches": sum(len(v) for v in results.values()),
    }
