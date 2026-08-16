"use client";

import { ReactNode, useState } from "react";

export interface OperatorEntry {
  id: string;
  saccoType: "NEW" | "EXISTING";
  overallStatus: "ACTIVE" | "REJECTED" | "PENDING_VERIFICATION";
  node: ReactNode;
}

const STATUS_FILTERS: { value: "ALL" | OperatorEntry["overallStatus"]; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "PENDING_VERIFICATION", label: "Pending" },
  { value: "ACTIVE", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

function OperatorTypeGroup({
  title,
  entries,
  defaultOpen,
  accent,
}: {
  title: string;
  entries: OperatorEntry[];
  defaultOpen: boolean;
  accent: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${accent}`} />
          <span className="font-extrabold text-sm text-county-black">{title}</span>
          <span className="badge bg-black/5 text-black/60 font-bold text-[10px]">{entries.length}</span>
        </div>
        <span className={`text-black/40 text-sm transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-black/5">
          {entries.length === 0 ? (
            <p className="text-xs text-black/40 italic py-4 text-center">No operators match this filter.</p>
          ) : (
            entries.map((e) => <div key={e.id}>{e.node}</div>)
          )}
        </div>
      )}
    </div>
  );
}

export default function OperatorVerificationBrowser({ entries }: { entries: OperatorEntry[] }) {
  const [statusFilter, setStatusFilter] = useState<"ALL" | OperatorEntry["overallStatus"]>("ALL");

  const filtered = entries.filter((e) => statusFilter === "ALL" || e.overallStatus === statusFilter);
  const existing = filtered.filter((e) => e.saccoType !== "NEW");
  const fresh = filtered.filter((e) => e.saccoType === "NEW");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-xs font-bold text-black/50">Filter by application status</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="text-xs border border-black/10 rounded-lg px-3 py-1.5 focus:outline-none focus:border-county-green bg-white font-semibold"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <OperatorTypeGroup title="Existing Operators" entries={existing} defaultOpen accent="bg-county-blue" />
        <OperatorTypeGroup title="New Applicants" entries={fresh} defaultOpen={false} accent="bg-county-green" />
      </div>
    </div>
  );
}
