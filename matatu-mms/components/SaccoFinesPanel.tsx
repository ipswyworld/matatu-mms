"use client";

import { useState, useTransition } from "react";
import { markFinePaidAction } from "@/lib/actions";
import { Fine } from "@/lib/types";
import { FineStatusPill } from "./StatusPill";
import NairobiPayBadge from "./NairobiPayBadge";

export default function SaccoFinesPanel({ fines }: { fines: Fine[] }) {
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handlePay = (fineId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await markFinePaidAction(fineId);
        setPaidIds((prev) => new Set(prev).add(fineId));
      } catch (err: any) {
        setError(err.message || "Payment could not be processed.");
      }
    });
  };

  const outstandingFines = fines.filter((f) => f.status === "PENDING" && !paidIds.has(f.id));

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-county-black">Outstanding Fines</h3>
          <p className="text-xs text-black/50">Citations issued by county enforcement against your fleet.</p>
        </div>
        <span className="badge bg-county-red/10 text-county-red font-bold">{outstandingFines.length} Pending</span>
      </div>

      {error && (
        <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2.5 text-xs font-semibold">
          {error}
        </div>
      )}

      {outstandingFines.length === 0 ? (
        <p className="text-sm text-black/40 py-4 text-center">No outstanding fines. Your fleet is in good standing.</p>
      ) : (
        <div className="space-y-2">
          {outstandingFines.map((f) => (
            <div key={f.id} className="flex items-center justify-between border border-black/10 rounded-lg p-3">
              <div>
                <div className="font-bold text-sm text-county-black">{f.regNumber} · KES {f.amountKes.toLocaleString()}</div>
                <div className="text-xs text-black/50">{f.reason} · Due {f.dueDate}</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-2">
                  <FineStatusPill status={f.status} />
                  <button
                    disabled={isPending}
                    onClick={() => handlePay(f.id)}
                    className="btn-primary !py-1.5 !px-3 text-xs font-bold"
                  >
                    {isPending ? "Processing..." : "Pay via NairobiPay"}
                  </button>
                </div>
                <NairobiPayBadge />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
