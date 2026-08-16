"use client";

import { useState, useTransition } from "react";
import { releaseEnforcementCaseAction, disputeEnforcementCaseAction, waiveEnforcementCaseAction } from "@/lib/actions";
import { EnforcementCaseStatus } from "@/lib/types";

export default function EnforcementCaseActions({ caseId, status }: { caseId: string; status: EnforcementCaseStatus }) {
  const [localStatus, setLocalStatus] = useState(status);
  const [mode, setMode] = useState<"none" | "dispute" | "waive">("none");
  const [reason, setReason] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (localStatus === "RELEASED" || localStatus === "DISPUTED" || localStatus === "WAIVED") {
    return <span className="text-[11px] font-bold text-black/40">No further action</span>;
  }

  const handleRelease = () => {
    setError(null);
    startTransition(async () => {
      const result = await releaseEnforcementCaseAction(caseId);
      if (result.error) { setError(result.error); return; }
      setLocalStatus("RELEASED");
    });
  };

  const handleDispute = () => {
    if (!reason.trim()) { setError("Enter a reason for the dispute."); return; }
    setError(null);
    startTransition(async () => {
      const result = await disputeEnforcementCaseAction(caseId, reason.trim());
      if (result.error) { setError(result.error); return; }
      setLocalStatus("DISPUTED");
    });
  };

  const handleWaive = () => {
    if (!reason.trim() || !authorizedBy.trim()) { setError("Both a reason and who authorized the waiver are required."); return; }
    setError(null);
    startTransition(async () => {
      const result = await waiveEnforcementCaseAction(caseId, reason.trim(), authorizedBy.trim());
      if (result.error) { setError(result.error); return; }
      setLocalStatus("WAIVED");
    });
  };

  return (
    <div className="space-y-1.5 min-w-[160px]">
      {error && <p className="text-[11px] text-county-red font-semibold">{error}</p>}

      {mode === "none" && (
        <div className="flex flex-wrap gap-1.5">
          <button
            disabled={isPending || localStatus !== "PAID"}
            onClick={handleRelease}
            title={localStatus !== "PAID" ? "Fine must be paid before release" : ""}
            className="text-[10px] font-bold text-white bg-county-green rounded px-2 py-1 disabled:opacity-40"
          >
            {localStatus === "PAID" ? "Release" : "Awaiting payment"}
          </button>
          <button onClick={() => setMode("dispute")} className="text-[10px] font-bold text-county-red hover:underline">
            Dispute
          </button>
          <button onClick={() => setMode("waive")} className="text-[10px] font-bold text-black/50 hover:underline">
            Waive
          </button>
        </div>
      )}

      {mode === "dispute" && (
        <div className="space-y-1">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Dispute reason"
            className="w-full text-[11px] border border-black/15 rounded px-2 py-1"
          />
          <div className="flex gap-1.5">
            <button disabled={isPending} onClick={handleDispute} className="text-[10px] font-bold text-white bg-county-red rounded px-2 py-1">
              {isPending ? "..." : "Confirm"}
            </button>
            <button onClick={() => setMode("none")} className="text-[10px] font-bold text-black/50">Cancel</button>
          </div>
        </div>
      )}

      {mode === "waive" && (
        <div className="space-y-1">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Waiver reason"
            className="w-full text-[11px] border border-black/15 rounded px-2 py-1"
          />
          <input
            value={authorizedBy}
            onChange={(e) => setAuthorizedBy(e.target.value)}
            placeholder="Authorized by (name/title)"
            className="w-full text-[11px] border border-black/15 rounded px-2 py-1"
          />
          <div className="flex gap-1.5">
            <button disabled={isPending} onClick={handleWaive} className="text-[10px] font-bold text-white bg-black/60 rounded px-2 py-1">
              {isPending ? "..." : "Confirm Waiver"}
            </button>
            <button onClick={() => setMode("none")} className="text-[10px] font-bold text-black/50">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
