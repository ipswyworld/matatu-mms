"use client";

import { useState, useTransition } from "react";
import { reviewReportAction } from "@/lib/actions";
import { PassengerReport, ReportStatus } from "@/lib/types";
import EmptyState from "./EmptyState";

const STATUS_STYLES: Record<ReportStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  REVIEWED: "bg-county-blue/10 text-county-blue",
  ESCALATED: "bg-county-red/10 text-county-red",
  DISMISSED: "bg-black/10 text-black/50",
};

export default function ReportsReviewPanel({ reports }: { reports: PassengerReport[] }) {
  const [localReports, setLocalReports] = useState(reports);
  const [isPending, startTransition] = useTransition();

  const handleUpdate = (id: string, status: ReportStatus) => {
    startTransition(async () => {
      await reviewReportAction(id, status);
      setLocalReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    });
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-county-black">Commuter Feedback & Overcharging Reports</h3>
          <p className="text-xs text-black/50">Submitted directly by passengers via the Passenger Portal app.</p>
        </div>
        <span className="badge bg-amber-100 text-amber-700 font-bold">
          {localReports.filter((r) => r.status === "PENDING").length} Pending Review
        </span>
      </div>

      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
        {localReports.length === 0 && (
          <EmptyState
            title="No passenger reports submitted yet"
            hint="Overcharging complaints and safety reports filed from the Passenger Portal will show up here for review."
          />
        )}
        {localReports.map((r) => (
          <div key={r.id} className="border border-black/10 rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="text-xs font-bold text-county-black">{r.category}</div>
                <div className="text-[11px] text-black/50">
                  {r.matatuRegNumber ? `Vehicle: ${r.matatuRegNumber} · ` : ""}
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <span className={`badge font-bold shrink-0 ${STATUS_STYLES[r.status]}`}>{r.status}</span>
            </div>
            <p className="text-xs text-black/70">{r.message}</p>
            {r.reporterName && (
              <p className="text-[10px] text-black/40">Reported by {r.reporterName}{r.reporterPhone ? ` · ${r.reporterPhone}` : ""}</p>
            )}
            {r.status === "PENDING" && (
              <div className="flex gap-2 pt-1">
                <button
                  disabled={isPending}
                  onClick={() => handleUpdate(r.id, "REVIEWED")}
                  className="btn-secondary !py-1 !px-2.5 text-[11px] font-bold"
                >
                  Mark Reviewed
                </button>
                <button
                  disabled={isPending}
                  onClick={() => handleUpdate(r.id, "ESCALATED")}
                  className="btn-danger !py-1 !px-2.5 text-[11px] font-bold"
                >
                  Escalate to Citation
                </button>
                <button
                  disabled={isPending}
                  onClick={() => handleUpdate(r.id, "DISMISSED")}
                  className="btn-secondary !py-1 !px-2.5 text-[11px] font-bold !text-black/50"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
