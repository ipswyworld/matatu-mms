"use client";

import { useState, useTransition } from "react";
import { decideLicenseRenewalAction } from "@/lib/actions";
import { Sacco } from "@/lib/types";

export default function LicenseRenewalPanel({ saccos }: { saccos: Sacco[] }) {
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const pending = saccos.filter((s) => s.licenseStatus === "RENEWAL_SUBMITTED" && !decided.has(s.id));

  const handleDecide = (saccoId: string, approve: boolean) => {
    startTransition(async () => {
      await decideLicenseRenewalAction(saccoId, approve);
      setDecided((prev) => new Set(prev).add(saccoId));
    });
  };

  if (pending.length === 0) return null;

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-county-black">Monthly License Renewal Approvals</h3>
          <p className="text-xs text-black/50">Saccos that have submitted their monthly permit renewal payment, awaiting county sign-off.</p>
        </div>
        <span className="badge bg-county-yellow text-yellow-900 font-bold">{pending.length} Awaiting Approval</span>
      </div>
      <div className="space-y-2">
        {pending.map((s) => (
          <div key={s.id} className="flex items-center justify-between border border-black/10 rounded-lg p-3">
            <div>
              <div className="font-bold text-sm text-county-black">{s.name}</div>
              <div className="text-xs text-black/50">Renewal payment submitted, pending county approval</div>
            </div>
            <div className="flex gap-2">
              <button
                disabled={isPending}
                onClick={() => handleDecide(s.id, true)}
                className="btn-primary !py-1.5 !px-3 text-xs font-bold"
              >
                Approve Renewal
              </button>
              <button
                disabled={isPending}
                onClick={() => handleDecide(s.id, false)}
                className="btn-secondary !py-1.5 !px-3 text-xs font-bold !text-county-red hover:!bg-county-red/10"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
