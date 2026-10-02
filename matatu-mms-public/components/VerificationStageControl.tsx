"use client";

import { useState, useTransition } from "react";

export default function VerificationStageControl({
  label,
  status,
  reason,
  decidedBy,
  decidedAt,
  canDecide,
  disabledHint,
  onDecide,
}: {
  label: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason?: string;
  decidedBy?: string;
  decidedAt?: string;
  canDecide: boolean;
  disabledHint?: string;
  onDecide: (status: "APPROVED" | "REJECTED", reason?: string) => Promise<{ error?: string }>;
}) {
  const [localStatus, setLocalStatus] = useState(status);
  const [reasonInput, setReasonInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const badgeClass =
    localStatus === "APPROVED"
      ? "bg-county-green/10 text-county-green"
      : localStatus === "REJECTED"
      ? "bg-county-red/10 text-county-red"
      : "bg-amber-100 text-amber-700";

  const act = (next: "APPROVED" | "REJECTED") => {
    if (next === "REJECTED" && !reasonInput.trim()) {
      setError("Enter a reason for rejection.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await onDecide(next, reasonInput.trim() || undefined);
      if (result.error) {
        setError(result.error);
        return;
      }
      setLocalStatus(next);
    });
  };

  return (
    <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] space-y-2 text-xs">
      <div className="flex justify-between items-center">
        <span className="font-extrabold text-county-black">{label}</span>
        <span className={`badge font-extrabold ${badgeClass}`}>{localStatus}</span>
      </div>
      {decidedBy && (
        <p className="text-[11px] text-black/50">
          Decided by <strong>{decidedBy}</strong> {decidedAt && `on ${new Date(decidedAt).toLocaleString()}`}
        </p>
      )}
      {reason && <p className="text-[11px] text-black/60">Reason: {reason}</p>}
      {error && <p className="text-county-red font-semibold">{error}</p>}

      {localStatus === "PENDING" && canDecide && (
        <div className="space-y-1.5 pt-1">
          <input
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            placeholder="Reason (required if rejecting)"
            className="w-full text-[11px] border border-black/15 rounded px-2 py-1 focus:outline-none focus:border-county-red"
          />
          <div className="flex gap-2">
            <button
              disabled={isPending}
              onClick={() => act("APPROVED")}
              className="btn-primary flex-1 !py-1.5 text-[11px] font-bold"
            >
              {isPending ? "Processing..." : "Approve"}
            </button>
            <button
              disabled={isPending}
              onClick={() => act("REJECTED")}
              className="btn-secondary flex-1 !py-1.5 text-[11px] font-bold !text-county-red hover:!bg-county-red/10"
            >
              {isPending ? "Processing..." : "Reject"}
            </button>
          </div>
        </div>
      )}
      {localStatus === "PENDING" && !canDecide && disabledHint && (
        <p className="text-[11px] text-black/40 italic pt-1">{disabledHint}</p>
      )}
    </div>
  );
}
