"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

interface OperatorRevenueRow {
  id: string;
  name: string;
  licenseStatus: "ACTIVE" | "RENEWAL_DUE" | "RENEWAL_SUBMITTED" | "EXPIRED";
  citationCount: number;
  paidKes: number;
  pendingKes: number;
}

const LICENSE_LABEL: Record<OperatorRevenueRow["licenseStatus"], string> = {
  ACTIVE: "ACTIVE",
  RENEWAL_SUBMITTED: "PENDING APPROVAL",
  RENEWAL_DUE: "RENEWAL DUE",
  EXPIRED: "EXPIRED",
};

const LICENSE_STYLE: Record<OperatorRevenueRow["licenseStatus"], string> = {
  ACTIVE: "bg-county-green/5 border-county-green/30",
  RENEWAL_SUBMITTED: "bg-county-blue/5 border-county-blue/30",
  RENEWAL_DUE: "bg-amber-500/5 border-amber-500/30",
  EXPIRED: "bg-county-red/5 border-county-red/30",
};

const LICENSE_BADGE: Record<OperatorRevenueRow["licenseStatus"], string> = {
  ACTIVE: "bg-county-green text-white",
  RENEWAL_SUBMITTED: "bg-county-blue text-white",
  RENEWAL_DUE: "bg-amber-500 text-white",
  EXPIRED: "bg-county-red text-white",
};

export default function OperatorRevenueFilter({ rows }: { rows: OperatorRevenueRow[] }) {
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(() => rows.find((r) => r.id === selectedId), [rows, selectedId]);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 pb-3">
        <div>
          <h3 className="font-extrabold text-base text-county-black">Operator License & Revenue Lookup</h3>
          <p className="text-xs text-black/60 mt-0.5">
            Pick an operator to see their monthly license status and revenue performance without scrolling a long list.
            Renewals are approved on the{" "}
            <Link href="/saccos/verify" className="font-bold text-county-green hover:underline">Operator Verification</Link> page.
          </p>
        </div>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="text-sm border border-black/10 rounded-lg px-3 py-1.5 focus:outline-none focus:border-county-green bg-white font-semibold min-w-[200px]"
        >
          <option value="" disabled>
            Select an operator
          </option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-black/40 italic py-4 text-center">No operators registered yet.</p>
      ) : !selected ? (
        <p className="text-xs text-black/40 italic py-6 text-center">Choose an operator above to see their license and revenue details.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className={`p-4 rounded-xl border space-y-2 ${LICENSE_STYLE[selected.licenseStatus]}`}>
            <div className="flex justify-between items-start">
              <div className="font-extrabold text-sm text-county-black">Monthly License</div>
              <span className={`badge text-[10px] font-extrabold ${LICENSE_BADGE[selected.licenseStatus]}`}>
                {LICENSE_LABEL[selected.licenseStatus]}
              </span>
            </div>
            <div className="text-xs text-black/60">
              Monthly Fee: <span className="font-bold text-black">KES 15,000</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-black/10 bg-black/[0.01] space-y-2">
            <div className="font-bold text-sm text-county-black">Revenue Performance</div>
            <div className="text-xs text-black/50">{selected.citationCount} citations total</div>
            <div className="flex justify-between items-center text-xs pt-2 border-t border-black/5">
              <span className="text-county-green font-semibold">Paid: KES {selected.paidKes.toLocaleString()}</span>
              <span className="text-county-red font-semibold">Pending: KES {selected.pendingKes.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
