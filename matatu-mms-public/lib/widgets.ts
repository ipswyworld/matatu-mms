// Typed widget-config layer (ARCHITECTURE_DECISIONS.md §25.1) — "a
// dashboard is a grid of configurable widgets, not a bespoke page per
// role." A role's dashboard becomes an ordered WidgetConfig[] rather than
// N hand-built pages; components/widgets/WidgetGrid.tsx renders whichever
// component a config's `type` maps to.
//
// Existing components already fit this shape without a rewrite:
// KpiCard (components/dashboard/KpiCard.tsx) is the KPI-tile widget,
// FinesTrendChart (Task 19) is the first trend-widget. This file is the
// registry/type layer connecting configs to those components — migrating
// every existing dashboard page to compose from WidgetConfig[] instead of
// hand-placed JSX is real follow-up work, not done in this pass (it would
// touch every role's dashboard page); what's here is the real,
// usable pattern + one live example (see WidgetGrid.tsx).

export type WidgetType = "kpi" | "trend" | "table";

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
}

export interface TableWidgetConfig {
  type: "table";
  key: string;
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
}

export type WidgetConfig = KpiWidgetConfig | TrendWidgetConfig | TableWidgetConfig;

// Example role templates — the "configuration" half of §25.1. Not wired
// into any page yet (see module docstring above); demonstrates the target
// shape a role's dashboard would be authored as.
export const ADMIN_DASHBOARD_TEMPLATE: WidgetConfig[] = [
  { type: "kpi", key: "fleet", label: "Registered vehicles", value: "", href: "/matatus" },
  { type: "kpi", key: "fines", label: "Outstanding fines", value: "", href: "/revenue" },
  { type: "trend", key: "fines-trend", metric: "fines", title: "Fines issued over time" },
];

export const SACCO_OPERATOR_DASHBOARD_TEMPLATE: WidgetConfig[] = [
  { type: "kpi", key: "fleet", label: "My fleet", value: "", href: "/matatus" },
  { type: "trend", key: "fines-trend", metric: "fines", title: "My fines over time" },
];
