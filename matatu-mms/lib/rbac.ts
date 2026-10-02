import { Role } from "./types";

// Single source of truth for "where does this role land by default" — used
// by lib/actions.ts's Server Actions (loginAction, verifyMfaAction) and by
// app/impersonate/consume/route.ts's Route Handler. Lives here rather than
// in actions.ts because that file has "use server" at the top, which
// requires every exported function to be async; this one is a plain,
// synchronous lookup shared across both contexts.
export function homeForRole(role: Role): string {
  if (role === "PASSENGER") return "/passenger-portal";
  if (role === "CREW") return "/crew-portal";
  if (role === "SACCO_OPERATOR") return "/sacco-portal";
  if (
    role === "ENFORCEMENT" ||
    role === "ARRESTING_OFFICER" ||
    role === "RELEASING_OFFICER" ||
    role === "ENFORCEMENT_COMMANDER"
  ) {
    return "/enforcement";
  }
  return "/dashboard";
}

/**
 * Central RBAC permission matrix for Mji-Move.
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
  | "manage_duty_allocation"
  | "send_broadcast"
  | "view_audit_logs"
  | "manage_admins"
  | "view_system_health"
  | "manage_system_config"
  | "view_scheduling_analytics";

// Every permission string the backend actually enforces (backend/app/rbac.py's
// ROLE_MATRIX) — a superset of the `Action` union above, which only covers
// what this frontend needs for nav/page gating. This is the checklist source
// for EditUserModal's "grant individual extra permissions" UI: it has to
// match what routes/users.py's ALL_ACTIONS validates against, or a grant
// picked here would 400 on save. Kept in sync by hand — there's no single
// source of truth shared across languages, same as the Action union itself.
export const ALL_BACKEND_PERMISSIONS: string[] = [
  "add_matatu", "approve_license_renewal", "book_ticket", "cancel_own_booking",
  "decide_enforcement_case", "decide_operator_verification_stage1", "decide_operator_verification_stage2",
  "dispute_fine", "edit_matatu_status", "file_enforcement_case", "issue_fine", "log_activity",
  "manage_admins", "manage_crew", "manage_crew_seats", "manage_duty_allocation", "manage_fare_stages", "manage_officer_assignments",
  "manage_routes", "manage_sacco_documents", "manage_system_config", "manage_trips", "manage_users",
  "pay_fine", "record_crime", "remove_matatu", "review_case_dispute", "review_report",
  "send_broadcast", "submit_license_renewal", "submit_report", "update_booking_status", "update_fine_status",
  "update_telemetry", "verify_saccos", "view_activity", "view_audit_logs", "view_crew",
  "view_dashboard", "view_enforcement_cases", "view_fines", "view_matatu_bookings", "view_matatus",
  "view_operator_verification", "view_own_bookings", "view_reports", "view_routes",
  "view_scheduling_analytics", "view_system_health", "view_users",
].sort();

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

// Exported so the read-only Role Matrix tab (ADMIN_DASHBOARD_AUDIT §3.3)
// can render straight from this source of truth instead of hand-maintaining
// a second copy of the permission grid.
export const MATRIX: Record<Role, Action[]> = {
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
    "manage_duty_allocation",
    "send_broadcast",
    "view_audit_logs",
    "view_system_health",
    "manage_system_config",
    "view_scheduling_analytics",
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
    "manage_duty_allocation",
    "send_broadcast",
    "view_audit_logs",
    "view_scheduling_analytics",
  ],
  DIRECTOR_MOBILITY: [
    "view_dashboard",
    "view_operator_verification",
    "decide_operator_verification_stage1",
    "view_scheduling_analytics",
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
    "manage_duty_allocation",
    "send_broadcast",
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
    "view_scheduling_analytics",
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

// Multi-role equivalent of can() — true if ANY of the user's roles (primary
// + additional, see SessionData.additionalRoles) grants the action.
export function canAny(roles: Role[], action: Action): boolean {
  return roles.some((r) => can(r, action));
}

// Shared parser for the two JSON-string-array-of-role-names fields on User
// (additionalRoles) and, generically, extraPermissions — same shape, same
// tolerance for null/malformed input. Kept here rather than duplicated in
// EditUserModal/lib/actions.
export function parseJsonStringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

// One-line capability summary shown inline on the "Add a user" role picker
// — same purpose as a Role Matrix tab would serve, just surfaced at the
// point of assignment instead of a separate page.
export const ROLE_CAPABILITY_SUMMARY: Partial<Record<Role, string>> = {
  SUPERADMIN: "Full system access, including creating other Admins.",
  ADMIN: "Full operational access — cannot create other Admins/Super Admins.",
  DIRECTOR_MOBILITY: "Decides Stage 1 of Operator verification.",
  CHIEF_OFFICER: "Decides Stage 2 (final) of Operator verification.",
  ENFORCEMENT: "Logs activity and issues citations, no case decisions.",
  ENFORCEMENT_COMMANDER: "Assigns officer duty/zone, decides enforcement cases.",
  ARRESTING_OFFICER: "Files enforcement cases from the roadside.",
  RELEASING_OFFICER: "Decides paid/disputed/waived cases and releases vehicles.",
  VIEWER: "Read-only access — dashboards and reports, no edits.",
};

// Groups STAFF_ROLES for the "Add a user" role picker so it reads as a
// structured org chart instead of a flat list — mirrors how the audit
// described the 12 real roles (Admin / Verification / Enforcement /
// Oversight tiers, plus the Public tier that's deliberately excluded here
// since those accounts are never created from this form — see STAFF_ROLES).
export const STAFF_ROLE_TIERS: { label: string; roles: Role[] }[] = [
  { label: "Admin", roles: ["SUPERADMIN", "ADMIN"] },
  { label: "Verification", roles: ["DIRECTOR_MOBILITY", "CHIEF_OFFICER"] },
  { label: "Enforcement", roles: ["ENFORCEMENT", "ENFORCEMENT_COMMANDER", "ARRESTING_OFFICER", "RELEASING_OFFICER"] },
  { label: "Oversight", roles: ["VIEWER"] },
];
