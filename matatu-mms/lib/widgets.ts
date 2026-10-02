// Typed widget-config layer (ARCHITECTURE_DECISIONS.md §25.1) — "a
// dashboard is a grid of configurable widgets, not a bespoke page per
// role." A role's dashboard becomes an ordered WidgetConfig[] rather than
// N hand-built pages; components/widgets/WidgetGrid.tsx renders whichever
// component a config's `type` maps to.
//
// Widget types map to the shared kit in components/widgets/ (extracted
// per ADMIN_DASHBOARD_AUDIT §5): KpiCard, TrendChart, StatusBreakdown,
// WorkQueueList. Migrating every existing dashboard page to compose from
// WidgetConfig[] instead of hand-placed JSX is real follow-up work, not
// done in this pass — what's here is the real, usable pattern; the admin
// dashboard (app/(app)/dashboard/page.tsx) already uses the underlying
// components directly (StatusBreakdown, TrendChart) without going through
// this config layer, which is fine — WidgetGrid is for roles/pages that
// want the config-driven composition, not a requirement for every page.

export type WidgetType = "kpi" | "trend" | "status" | "workqueue" | "table";

export interface KpiWidgetConfig {
  type: "kpi";
  key: string;
  label: string;
  value: string;
  accent?: "green" | "red" | "yellow" | "neutral";
  href?: string;
}

export interface TrendWidgetConfig {
  type: "trend";
  key: string;
  metric: "fines" | "bookings";
  title: string;
  countUnit: string;
  color?: string;
}

export interface StatusWidgetConfig {
  type: "status";
  key: string;
  title: string;
  subtitle?: string;
  variant?: "donut" | "bar";
  segments: { key: string; label: string; color: string; value: number }[];
}

export interface WorkQueueWidgetConfig {
  type: "workqueue";
  key: string;
  title: string;
  subtitle?: string;
  items: { id: string; label: string; detail?: string; ageLabel?: string; href?: string }[];
  viewAllHref?: string;
}

export interface TableWidgetConfig {
  type: "table";
  key: string;
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
}

export type WidgetConfig = KpiWidgetConfig | TrendWidgetConfig | StatusWidgetConfig | WorkQueueWidgetConfig | TableWidgetConfig;

// Example role templates — the "configuration" half of §25.1. Not wired
// into any page yet; demonstrates the target shape a role's dashboard
// would be authored as once a page actually consumes WidgetGrid.
export const ADMIN_DASHBOARD_TEMPLATE: WidgetConfig[] = [
  { type: "kpi", key: "fleet", label: "Registered vehicles", value: "", href: "/matatus" },
  { type: "kpi", key: "fines", label: "Outstanding fines", value: "", href: "/revenue" },
  { type: "trend", key: "fines-trend", metric: "fines", title: "Fines issued over time", countUnit: "fines" },
];

export const SACCO_OPERATOR_DASHBOARD_TEMPLATE: WidgetConfig[] = [
  { type: "kpi", key: "fleet", label: "My fleet", value: "", href: "/matatus" },
  { type: "trend", key: "fines-trend", metric: "fines", title: "My fines over time", countUnit: "fines" },
];

// Target shape for the still-missing Director/Chief Officer persona
// dashboard (SYSTEM_AUDIT §6, ADMIN_DASHBOARD_AUDIT §6.1) — built on
// WorkQueueList once that page actually exists; not wired up yet.
export const VERIFICATION_STAGE_DASHBOARD_TEMPLATE: WidgetConfig[] = [
  { type: "kpi", key: "awaiting", label: "Awaiting your decision", value: "", href: "/saccos/verify" },
  { type: "workqueue", key: "queue", title: "Applications awaiting your stage", items: [], viewAllHref: "/saccos/verify" },
];
