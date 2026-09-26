"use client";

import { useState, useTransition } from "react";
import { submitOperatorTerminalAction } from "@/lib/actions";
import { OperatorTerminal, Route } from "@/lib/types";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Checking…", className: "bg-black/5 text-county-black/60" },
  MATCHED_EXISTING_STAGE: { label: "Matched to a known stage", className: "bg-county-green/10 text-county-green" },
  GEOCODED_NEW: { label: "Confirmed on the map", className: "bg-county-green/10 text-county-green" },
  MANUALLY_SET: { label: "Confirmed by county staff", className: "bg-county-green/10 text-county-green" },
  UNRESOLVED: { label: "Needs county confirmation", className: "bg-county-yellow/10 text-county-black" },
};

/** An operator declares their real designated pick-up/drop-off area
 * (Nairobi City County PSV audit terms — "the terminal") per route they
 * run. The label is auto-matched against the map immediately server-side
 * (app/terminal_matching.py) — never left as unconfirmed raw text. Modeled
 * on FareChartUploadCard's route-picker + submit pattern. */
export default function OperatorTerminalCard({ routes, existing }: { routes: Route[]; existing: OperatorTerminal[] }) {
  const [routeId, setRouteId] = useState(routes[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<OperatorTerminal[]>(existing);
  const [isPending, startTransition] = useTransition();

  if (routes.length === 0) return null;

  const handleSubmit = () => {
    if (!routeId) {
      setError("Pick which route this terminal is for.");
      return;
    }
    if (!label.trim()) {
      setError("Describe your designated pick-up/drop-off area.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitOperatorTerminalAction({ routeId, label: label.trim() });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.terminal) {
        setSubmitted((prev) => [res.terminal!, ...prev]);
        setLabel("");
      }
    });
  };

  const routeById = new Map(routes.map((r) => [r.id, r]));

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h3 className="font-bold text-sm text-county-black">Your Designated Pick-Up / Drop-Off Area</h3>
        <p className="text-xs text-black/50">
          Declare your real terminal per route you run — this feeds the county GIS map and helps passengers find
          where to board. We check it against the map automatically; anything we can't confirm gets flagged for
          county staff to fix.
        </p>
      </div>

      {error && (
        <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-2.5 rounded-lg font-semibold">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="input font-semibold w-auto text-xs !py-1.5">
          {routes.map((r) => (
            <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Koja Terminus, Old Nation"
          className="input flex-1 min-w-[180px] text-xs !py-1.5"
        />
        <button type="button" onClick={handleSubmit} disabled={isPending} className="btn-secondary !py-1 !px-2.5 text-[10px] font-bold">
          {isPending ? "Submitting…" : "Submit Terminal"}
        </button>
      </div>

      {submitted.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {submitted.map((t) => {
            const status = STATUS_LABEL[t.matchStatus] ?? STATUS_LABEL.PENDING;
            return (
              <div key={t.id} className="flex items-center justify-between text-xs bg-black/[0.02] rounded-lg px-3 py-2 border border-black/5">
                <div>
                  <span className="font-bold text-county-black">{t.label}</span>
                  <span className="text-black/40"> · {routeById.get(t.routeId)?.code || t.routeId}</span>
                </div>
                <span className={`badge font-bold ${status.className}`}>{status.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
