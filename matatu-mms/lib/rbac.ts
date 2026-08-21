import { Role } from "./types";

/**
 * Central RBAC permission matrix for the NCCG Matatu Management System.
 */

export type Action =
  | "view_dashboard"
  | "view_matatus"
  | "add_matatu"
  | "edit_matatu_status"
  | "view_routes"
  | "manage_routes"
  | "view_activity"
  | "log_activity"
  | "view_fines"
  | "issue_fine"
  | "update_fine_status"
  | "dispute_fine"
  | "view_users"
  | "manage_users"
  | "view_enforcement"
  | "view_passengers"
  | "view_revenue"
  | "view_passenger_portal"
  | "view_crew_portal"
  | "view_sacco_portal"
  | "verify_saccos"
  | "record_crime"
  | "book_ticket"
  | "manage_crew_seats"
  | "submit_report"
  | "view_reports"
  | "review_report"
  | "pay_fine"
  | "submit_license_renewal"
  | "approve_license_renewal"
  | "cancel_own_booking"
  | "manage_sacco_documents"
  | "view_operator_verification"
  | "decide_operator_verification_stage1"
  | "decide_operator_verification_stage2"
  | "remove_matatu"
  | "view_enforcement_cases"
  | "file_enforcement_case"
  | "decide_enforcement_case"
  | "review_case_dispute"
  | "manage_officer_assignments"
  | "view_audit_logs"
  | "manage_admins"
  | "view_system_health"
  | "manage_system_config";

// Roles allowed to hold system-wide administrative power. Kept in sync with
// the backend's ADMIN_TIER_ROLES (app/rbac.py) — anything gated by that set
// server-side should be gated by this set client-side too.
export const ADMIN_TIER_ROLES: Role[] = ["ADMIN", "SUPERADMIN"];

// County staff/government accounts — the population the "Users & Roles"
// admin page manages. Deliberately excludes SACCO_OPERATOR, CREW, and
// PASSENGER: those are Sacco/fleet/commuter accounts with their own
// lifecycle (created via Sacco verification, issued by an operator, or
// self-registered) and mixing them into one staff roster made "how many
// county staff do we have" impossible to answer at a glance.
export const STAFF_ROLES: Role[] = [
  "SUPERADMIN",
  "ADMIN",
  "DIRECTOR_MOBILITY",
  "CHIEF_OFFICER",
  "ENFORCEMENT",
  "ARRESTING_OFFICER",
  "RELEASING_OFFICER",
  "ENFORCEMENT_COMMANDER",
  "VIEWER",
];

const MATRIX: Record<Role, Action[]> = {
  SUPERADMIN: [
    "view_dashboard",
    "view_matatus",
    "edit_matatu_status",
    "view_routes",
    "manage_routes",
    "view_activity",
    "view_enforcement",
    "view_fines",
    "issue_fine",
    "update_fine_status",
    "view_users",
    "manage_users",
    "manage_admins",
    "view_passengers",
    "view_revenue",
    "verify_saccos",
    "approve_license_renewal",
    "view_reports",
    "review_report",
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
  ],
  ADMIN: [
    "view_dashboard",
    "view_matatus",
    "edit_matatu_status",
    "view_routes",
    "manage_routes",
    "view_activity",
    "view_enforcement",
    "view_fines",
    "issue_fine",
    "update_fine_status",
    "view_users",
    "manage_users",
    "view_passengers",
    "view_revenue",
    "verify_saccos",
    "approve_license_renewal",
    "view_reports",
    "review_report",
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
  ],
  DIRECTOR_MOBILITY: [
    "view_dashboard",
    "view_operator_verification",
    "decide_operator_verification_stage1",
  ],
  CHIEF_OFFICER: [
    "view_dashboard",
    "view_operator_verification",
    "decide_operator_verification_stage2",
  ],
  ENFORCEMENT: [
    "view_dashboard",
    "view_matatus",
    "edit_matatu_status",
    "view_routes",
    "view_activity",
    "log_activity",
    "view_fines",
    "issue_fine",
    "view_enforcement",
    "record_crime",
    "view_reports",
    "review_report",
  ],
  ARRESTING_OFFICER: [
    "view_dashboard",
    "view_matatus",
    "view_routes",
    "view_activity",
    "view_enforcement",
    "file_enforcement_case",
    "view_enforcement_cases",
    "view_users",
    "view_reports",
  ],
  RELEASING_OFFICER: [
    "view_dashboard",
    "view_matatus",
    "view_routes",
    "view_activity",
    "view_enforcement",
    "view_enforcement_cases",
    "decide_enforcement_case",
    "view_users",
    "view_reports",
  ],
  ENFORCEMENT_COMMANDER: [
    "view_dashboard",
    "view_matatus",
    "view_routes",
    "view_activity",
    "view_enforcement",
    "view_enforcement_cases",
    "file_enforcement_case",
    "decide_enforcement_case",
    "review_case_dispute",
    "manage_officer_assignments",
    "view_users",
    "view_reports",
    "review_report",
  ],
  SACCO_OPERATOR: [
    "view_sacco_portal",
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
    "view_revenue",
  ],
  VIEWER: [
    "view_dashboard",
    "view_matatus",
    "view_routes",
    "view_activity",
    "view_fines",
    "view_passengers",
    "view_revenue",
    "view_reports",
  ],
  PASSENGER: [
    "view_passenger_portal",
    "book_ticket",
    "cancel_own_booking",
    "submit_report",
  ],
  CREW: [
    "view_crew_portal",
    "manage_crew_seats",
  ],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role]?.includes(action) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPERADMIN: "Super Administrator",
  ADMIN: "System Administrator",
  ENFORCEMENT: "Enforcement Officer",
  SACCO_OPERATOR: "Operator",
  VIEWER: "Viewer / Executive",
  PASSENGER: "Commuter Passenger",
  CREW: "Driver / Conductor",
  DIRECTOR_MOBILITY: "Director of Mobility",
  CHIEF_OFFICER: "Chief Officer",
  ARRESTING_OFFICER: "Arresting Officer",
  RELEASING_OFFICER: "Releasing Officer",
  ENFORCEMENT_COMMANDER: "Enforcement Commander",
};
