"""
Centralized attribute-based access control (ABAC) — the layer on top of
RBAC's role -> permission matrix (app/rbac.py). RBAC answers "can this role
perform this action at all"; ABAC answers "does this specific record belong
to this specific user" — e.g. a Sacco Operator can view matatus in general,
but only the ones belonging to their own Sacco.

Before this module existed, every route re-wrote the same sacco_id / zone /
ownership comparison inline (24 near-identical call sites across 8 files).
That's fine until the rule changes — then you're hunting for every copy.
Declaring each rule once here means:
  1. One place to change a rule.
  2. One list (POLICIES) the /system console can display for audit —
     "what are the actual data-access rules in this system" is a real
     question a Super Admin should be able to answer without reading code.

Each policy is a small (user, resource_value) -> bool predicate plus a
human-readable description. The `enforce_*` helpers wrap a predicate with
the HTTPException a route actually needs, matching the exact status/detail
that was already in use in each call site being centralized.
"""

from dataclasses import dataclass
from typing import Any, Callable, Optional

from fastapi import HTTPException, status


@dataclass(frozen=True)
class Policy:
    id: str
    description: str
    applies_to_roles: tuple


# --- Predicates -------------------------------------------------------

def is_own_sacco(user: Any, sacco_id: Optional[str]) -> bool:
    """True if `sacco_id` belongs to this user's own Sacco."""
    return user.sacco_id is not None and sacco_id == user.sacco_id


def is_own_record(user: Any, owner_user_id: Optional[str]) -> bool:
    """True if a record's owning user_id is this user."""
    return owner_user_id == user.id


# --- Declared policies (for the /system console's ABAC inspector) -----

POLICIES = [
    Policy(
        id="sacco_scoped_fleet_access",
        description="A Sacco Operator or Crew member may only view or manage matatus, fines, activity logs, bookings, telemetry, and webhook subscriptions belonging to their own Sacco.",
        applies_to_roles=("SACCO_OPERATOR", "CREW"),
    ),
    Policy(
        id="sacco_scoped_document_management",
        description="A user may only upload verification documents, edit bonafide officials, submit the onboarding application, or pay license renewals for their own Sacco.",
        applies_to_roles=("SACCO_OPERATOR",),
    ),
    Policy(
        id="passenger_owns_booking",
        description="A Passenger may only view or cancel their own bookings, never another passenger's.",
        applies_to_roles=("PASSENGER",),
    ),
    Policy(
        id="arresting_officer_owns_case",
        description="An Arresting Officer only sees enforcement cases they personally filed; Releasing Officers, Commanders, and Admin see the full case queue.",
        applies_to_roles=("ARRESTING_OFFICER",),
    ),
    Policy(
        id="case_zone_auto_assignment",
        description="When an Arresting Officer files a new enforcement case, its zone is automatically set to the officer's own assigned zone, not caller-supplied.",
        applies_to_roles=("ARRESTING_OFFICER",),
    ),
    Policy(
        id="admin_tier_self_management",
        description="Only a Super Admin may create, edit, or change the role of an Admin or Super Admin account; the last remaining Super Admin cannot be demoted.",
        applies_to_roles=("SUPERADMIN",),
    ),
]


# --- Enforcement helpers ------------------------------------------------
# Thin wrappers so call sites read as one line instead of re-deriving the
# HTTPException each time. Behavior (status code + message) matches what
# was already enforced inline at each of the call sites these replace.

def enforce_own_sacco(user: Any, sacco_id: Optional[str], detail: str = "You can only access resources belonging to your own Sacco.") -> None:
    if user.role in ("SACCO_OPERATOR", "CREW") and not is_own_sacco(user, sacco_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def enforce_own_sacco_operator_only(user: Any, sacco_id: Optional[str], detail: str = "You can only manage your own Sacco's records.") -> None:
    """Narrower variant: applies to any caller (not just SACCO_OPERATOR/CREW)
    for endpoints where role is already gated elsewhere and the remaining
    check is purely "is this your own Sacco" — matches saccos.py's document/
    officials/application/renewal endpoints."""
    if not is_own_sacco(user, sacco_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def sacco_scope_query(user: Any, query, sacco_id_column):
    """Applies the same 'own Sacco only' filter to a SELECT query, for list
    endpoints (as opposed to enforce_own_sacco, which is for single-record
    reads/writes)."""
    if user.role in ("SACCO_OPERATOR", "CREW"):
        query = query.where(sacco_id_column == user.sacco_id)
    return query


def enforce_own_record(user: Any, owner_user_id: Optional[str], detail: str = "This resource does not belong to you.") -> None:
    if user.role == "PASSENGER" and not is_own_record(user, owner_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
