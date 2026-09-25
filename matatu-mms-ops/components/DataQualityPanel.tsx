"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck } from "lucide-react";
import { DataQualityCheck } from "@/lib/types";
import { scanDataQualityNowAction } from "@/lib/actions";
import ActionButton from "@/components/ActionButton";

const CHECK_LABEL: Record<string, string> = {
  orphaned_fines_matatu: "Fines referencing a missing matatu",
  orphaned_enforcement_cases_officer: "Enforcement cases referencing a missing officer",
  orphaned_bookings_matatu: "Bookings referencing a missing matatu",
};

/**
 * Reads app/data_quality.py's weekly orphaned-FK checks. No remediation
 * runs from here — same review-only posture as retention review.
 */
export default function DataQualityPanel({ checks }: { checks: DataQualityCheck[] }) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
            <ClipboardCheck size={15} strokeWidth={2} className="text-county-ink/50" />
            Data Quality
          </h3>
          <p className="text-xs text-black/50 mt-0.5">Orphaned foreign keys — counted weekly, never fixed automatically.</p>
        </div>
        <ActionButton
          actionId="dataQuality.scanNow"
          target="data quality checks"
          onConfirm={(reason) => scanDataQualityNowAction(reason)}
          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 transition-colors"
        >
          Scan now
        </ActionButton>
      </div>

      <div className="space-y-1.5">
        {checks.map((c) => (
          <div key={c.checkName} className="flex items-center justify-between gap-3 text-[11px] py-2 border-b border-black/5 last:border-0 flex-wrap">
            <span className="text-county-black">{CHECK_LABEL[c.checkName] || c.checkName}</span>
            <span className="flex items-center gap-2">
              {c.issueCount === null ? (
                <span className="text-black/35 italic">never scanned</span>
              ) : c.issueCount === 0 ? (
                <span className="badge text-[9px] font-extrabold bg-county-green/10 text-county-green inline-flex items-center gap-1">
                  <CheckCircle2 size={10} /> CLEAN
                </span>
              ) : (
                <span className="badge text-[9px] font-extrabold bg-amber-100 text-amber-800 inline-flex items-center gap-1" title={c.sampleIds.join(", ")}>
                  <AlertTriangle size={10} /> {c.issueCount} FOUND
                </span>
              )}
              {c.checkedAt && <span className="text-black/35">{new Date(c.checkedAt).toLocaleString()}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
