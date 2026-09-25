"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export default function UsersTabs({
  staffCount,
  publicCount,
  staffPanel,
  publicPanel,
  roleMatrixPanel,
  showRoleMatrix = true,
}: {
  staffCount: number;
  publicCount: number;
  staffPanel: ReactNode;
  publicPanel: ReactNode;
  roleMatrixPanel: ReactNode;
  /** Gated by the staff_role_matrix_enabled feature flag — the first real
   *  flag consumer in this codebase (backend/app/routes/feature_flags.py's
   *  is_feature_enabled). Defaults to true so a call site that doesn't pass
   *  this (or a flag-check failure) never silently hides the tab. */
  showRoleMatrix?: boolean;
}) {
  const [tab, setTab] = useState<"staff" | "public" | "matrix">("staff");

  const tabs = [
    { key: "staff" as const, label: "County Staff", count: staffCount },
    { key: "public" as const, label: "Public Directory", count: publicCount },
    ...(showRoleMatrix ? [{ key: "matrix" as const, label: "Role Matrix", count: null }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 border-b border-black/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-county-green text-county-green"
                : "border-transparent text-black/40 hover:text-black/60"
            }`}
          >
            {t.label} {t.count !== null && <span className="text-[10px] font-normal">({t.count})</span>}
          </button>
        ))}
      </div>
      {tab === "staff" && staffPanel}
      {tab === "public" && publicPanel}
      {tab === "matrix" && roleMatrixPanel}
    </div>
  );
}
