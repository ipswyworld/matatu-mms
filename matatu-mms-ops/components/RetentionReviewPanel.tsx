"use client";

import { Download, Archive } from "lucide-react";
import { RetentionReviewRow } from "@/lib/types";
import { scanRetentionNowAction } from "@/lib/actions";
import { downloadCsv } from "@/lib/csvExport";
import ActionButton from "@/components/ActionButton";

/**
 * Review-only, as the plan and app/retention.py both insist on: this
 * surfaces closed fines/enforcement cases old enough that Kenya's 7-year
 * statutory floor no longer requires keeping them, for a human with legal
 * sign-off to act on later. Nothing here — not even the manual scan —
 * deletes a row.
 */
export default function RetentionReviewPanel({ rows }: { rows: RetentionReviewRow[] }) {
  function exportCsv() {
    downloadCsv(
      `retention-review-${new Date().toISOString().slice(0, 10)}`,
      ["Table", "Eligible records", "Oldest eligible date", "Last scanned"],
      rows.map((r) => [r.tableName, r.eligibleCount ?? "—", r.oldestEligibleDate ?? "—", r.scannedAt ?? "never"]),
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
            <Archive size={15} strokeWidth={2} className="text-county-ink/50" />
            Data Retention Review
          </h3>
          <p className="text-xs text-black/50 mt-0.5">
            Closed records past Kenya&apos;s 7-year statutory floor — review-only, nothing is ever deleted from here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 transition-colors inline-flex items-center gap-1.5">
            <Download size={12} /> CSV
          </button>
          <ActionButton
            actionId="retention.scanNow"
            target="retention review"
            onConfirm={(reason) => scanRetentionNowAction(reason)}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 transition-colors"
          >
            Scan now
          </ActionButton>
        </div>
      </div>

      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.tableName} className="flex items-center justify-between gap-3 text-[11px] py-2 border-b border-black/5 last:border-0 flex-wrap">
            <span className="font-mono font-semibold text-county-black">{r.tableName}</span>
            <span className="text-black/60">
              {r.eligibleCount === null ? (
                <span className="text-black/35 italic">never scanned</span>
              ) : (
                <>
                  <span className={r.eligibleCount > 0 ? "font-bold text-amber-700" : ""}>{r.eligibleCount}</span> eligible
                  {r.oldestEligibleDate && <> · oldest {new Date(r.oldestEligibleDate).toLocaleDateString()}</>}
                  {r.scannedAt && <span className="text-black/35"> · scanned {new Date(r.scannedAt).toLocaleString()}</span>}
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
