from typing import List, Dict

# Roles allowed to hold system-wide administrative power. Only accounts with
# one of these roles may be assigned to (or edited by someone assigned to)
# ADMIN/SUPERADMIN — enforced in routes/users.py, not just here.
ADMIN_TIER_ROLES = {"ADMIN", "SUPERADMIN"}

# County staff/government accounts, formalizing what routes/users.py's
# get_users() and create_user() already implicitly assume — the roles
# managed on the "Users & Roles" staff roster, as opposed to the public
# accounts (SACCO_OPERATOR, CREW, PASSENGER) that each have their own
# separate lifecycle (onboarding wizard + county approval, issued by their
# operator, or self-registration). Kept in sync with the frontend's
# STAFF_ROLES (matatu-mms/lib/rbac.ts).
STAFF_ROLES = {
    "SUPERADMIN",
    "ADMIN",
    "DIRECTOR_MOBILITY",
    "CHIEF_OFFICER",
    "ENFORCEMENT",
    "ARRESTING_OFFICER",
    "RELEASING_OFFICER",
    "ENFORCEMENT_COMMANDER",
    "VIEWER",
}

ROLE_MATRIX: Dict[str, List[str]] = {
    "SUPERADMIN": [
        "view_dashboard",
        "view_matatus",
        "edit_matatu_status",
        "view_routes",
        "manage_routes",
        "view_activity",
        "view_fines",
        "issue_fine",
        "update_fine_status",
        "view_users",
        "manage_users",
        "manage_admins",
        "update_booking_status",
        "view_reports",
        "review_report",
        "verify_saccos",
        "approve_license_renewal",
        "view_operator_verification",
        "decide_operator_verification_stage1",
        "decide_operator_verification_stage2",
        "remove_matatu",
        "record_crime",
        "view_enforcement_cases",
        "file_enforcement_case",
        "decide_enforcement_case",
        "review_case_dispute",
        "manage_officer_assignments",
        "view_audit_logs",
        "view_system_health",
        "manage_system_config",
        "manage_crew",
        "view_crew",
        "manage_fare_stages",
    ],
    "ADMIN": [
        "view_dashboard",
        "view_matatus",
        "edit_matatu_status",
        "view_routes",
        "manage_routes",
        "view_activity",
        "view_fines",
        "issue_fine",
        "update_fine_status",
        "view_users",
        "manage_users",
        "update_booking_status",
        "view_reports",
        "review_report",
        "verify_saccos",
        "approve_license_renewal",
        "view_operator_verification",
        "decide_operator_verification_stage1",
        "decide_operator_verification_stage2",
        "remove_matatu",
        "record_crime",
        "view_enforcement_cases",
        "file_enforcement_case",
        "decide_enforcement_case",
        "review_case_dispute",
        "manage_officer_assignments",
        "view_audit_logs",
        "manage_crew",
        "view_crew",
        "manage_fare_stages",
    ],
    "DIRECTOR_MOBILITY": [
        "view_dashboard",
        "view_operator_verification",
        "decide_operator_verification_stage1",
        # Read-only — /saccos/verify's crew-roster panel needs this to see
        # who's assigned to each Sacco's fleet during verification. Actually
        # managing crew (issuing/revoking credentials) stays manage_crew-only,
        # which this role deliberately doesn't have.
        "view_crew",
    ],
    "CHIEF_OFFICER": [
        "view_dashboard",
        "view_operator_verification",
        "decide_operator_verification_stage2",
        "view_crew",
    ],
    "ENFORCEMENT": [
        "view_dashboard",
        "view_matatus",
        "edit_matatu_status",
        "view_routes",
        "view_activity",
        "log_activity",
        "view_fines",
        "issue_fine",
        "view_reports",
        "review_report",
        "view_users",
        "record_crime",
    ],
    "ARRESTING_OFFICER": [
        "view_dashboard",
        "view_matatus",
        "view_routes",
        "view_activity",
        "log_activity",
        "file_enforcement_case",
        "view_enforcement_cases",
        "view_users",
        "view_reports",
    ],
    "RELEASING_OFFICER": [
        "view_dashboard",
        "view_matatus",
        "view_routes",
        "view_activity",
        "view_enforcement_cases",
        "decide_enforcement_case",
        "view_users",
        "view_reports",
    ],
    "ENFORCEMENT_COMMANDER": [
        "view_dashboard",
        "view_matatus",
        "view_routes",
        "view_activity",
        "view_enforcement_cases",
        "file_enforcement_case",
        "decide_enforcement_case",
        "review_case_dispute",
        "manage_officer_assignments",
        "view_users",
        "view_reports",
        "review_report",
    ],
    "SACCO_OPERATOR": [
        "view_dashboard",
        "view_matatus",
        "add_matatu",
        "view_routes",
        "view_activity",
        "view_fines",
        "dispute_fine",
        "pay_fine",
        "submit_license_renewal",
        "manage_sacco_documents",
        "remove_matatu",
        "view_users",
        "manage_crew",
        "view_crew",
        "manage_fare_stages",
        "view_reports",
        "view_enforcement_cases",
    ],
    "VIEWER": [
        "view_dashboard",
        "view_matatus",
        "view_routes",
        "view_activity",
        "view_fines",
        "view_users",
        "view_reports",
    ],
    "PASSENGER": [
        "view_matatus",
        "view_routes",
        "book_ticket",
        "view_own_bookings",
        "cancel_own_booking",
        "submit_report",
    ],
    "CREW": [
        "view_matatus",
        "view_routes",
        "manage_crew_seats",
        "view_matatu_bookings",
        "update_telemetry",
        "book_ticket",
        "update_booking_status",
        "log_activity",
        "view_reports",
        "manage_trips",
    ],
}

def can(role: str, action: str) -> bool:
    return action in ROLE_MATRIX.get(role, [])

# Every action that appears anywhere in ROLE_MATRIX — the valid set for a
# user's individual extra_permissions grant (routes/users.py validates
# against this so a typo'd action string doesn't silently do nothing) and
# for the frontend's grant-permissions checklist UI.
ALL_ACTIONS: List[str] = sorted({action for actions in ROLE_MATRIX.values() for action in actions})


def user_permissions(user) -> set:
    """A user's actual permission set: their role's bundle, plus any
    individual extra grants (User.extra_permissions, a JSON list of action
    strings — see models.py). Falls back to role-only if the column is
    unset/unparseable, which covers every account that's never had extra
    permissions granted."""
    import json
    perms = set(ROLE_MATRIX.get(user.role, []))
    raw = getattr(user, "extra_permissions", None)
    if raw:
        try:
            perms |= set(json.loads(raw))
        except (ValueError, TypeError):
            pass
    return perms


def has_permission(user, action: str) -> bool:
    return action in user_permissions(user)
