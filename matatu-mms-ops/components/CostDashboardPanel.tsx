"use client";

import { useState } from "react";
import { CostSnapshot } from "@/lib/types";
import { recordCostSnapshotAction } from "@/lib/actions";
import ActionButton from "@/components/ActionButton";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Manual-entry cost dashboard — the plan's own documented fallback, since
 * Render's public API has no billing endpoint to pull real spend from
 * automatically. A human types in what the invoice said each month; this
 * only charts the trend.
 */
export default function CostDashboardPanel({ snapshots }: { snapshots: CostSnapshot[] }) {
  const [month, setMonth] = useState(currentMonth());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const max = Math.max(1, ...snapshots.map((s) => parseFloat(s.amountKes)));

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Infrastructure Cost</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Manually entered — Render&apos;s API exposes no billing data to read automatically. Type in what each
          month&apos;s invoice actually said.
        </p>
      </div>

      {snapshots.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-end gap-2 h-24">
            {snapshots.map((s) => (
              <div key={s.month} className="flex-1 flex flex-col items-center justify-end gap-1" title={`KES ${s.amountKes}`}>
                <div
                  className="w-full bg-county-green/70 rounded-sm min-h-[2px]"
                  style={{ height: `${Math.max(4, (parseFloat(s.amountKes) / max) * 100)}%` }}
                />
                <span className="text-[9px] text-black/40 font-mono">{s.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-2 items-end pt-2 border-t border-black/10">
        <div>
          <label className="label" htmlFor="cost-month">Month</label>
          <input id="cost-month" type="month" className="input text-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cost-amount">Amount (KES)</label>
          <input
            id="cost-amount"
            type="number"
            min="0"
            step="0.01"
            className="input text-xs"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="label" htmlFor="cost-note">Note (optional)</label>
          <input id="cost-note" type="text" className="input text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Render, GitHub, ..." />
        </div>
      </div>

      <ActionButton
        actionId="cost.record"
        target={month}
        disabled={!amount}
        onConfirm={(reason) => recordCostSnapshotAction(month, amount, note, reason)}
        className="text-[11px] font-bold px-3 py-2 rounded-lg bg-county-green text-white hover:bg-county-green-dark disabled:opacity-40 transition-colors"
      >
        Record cost for {month}
      </ActionButton>
    </div>
  );
}
