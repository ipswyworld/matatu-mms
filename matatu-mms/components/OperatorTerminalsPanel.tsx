"use client";

import { Fragment, useState, useTransition } from "react";
import { MapPin, CheckCircle2 } from "lucide-react";
import { resolveOperatorTerminalAction } from "@/lib/actions";
import { OperatorTerminal, Route, Sacco } from "@/lib/types";

const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-black/5 text-county-black/60",
  MATCHED_EXISTING_STAGE: "bg-county-green/10 text-county-green",
  GEOCODED_NEW: "bg-county-green/10 text-county-green",
  MANUALLY_SET: "bg-county-blue/10 text-county-blue",
  UNRESOLVED: "bg-county-yellow/20 text-yellow-900",
};

interface OperatorTerminalsPanelProps {
  terminals: OperatorTerminal[];
  saccos: Sacco[];
  routes: Route[];
  /** Only ADMIN/SUPERADMIN get this (resolve_operator_terminals) — this
   * mutates canonical map data. DIRECTOR_MOBILITY/CHIEF_OFFICER see the
   * same panel read-only via view_operator_terminals alone. */
  canResolve: boolean;
}

/**
 * Every operator-submitted terminal (their real designated pick-up/
 * drop-off area per route, from the county's own PSV audit terms) with the
 * outcome of the automatic map-matching pass — county staff can see at a
 * glance what's confirmed and fix the rest by hand.
 */
export default function OperatorTerminalsPanel({ terminals, saccos, routes, canResolve }: OperatorTerminalsPanelProps) {
  const saccoById = new Map(saccos.map((s) => [s.id, s]));
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (terminals.length === 0) return null;

  const handleResolve = (terminalId: string) => {
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setError("Enter both a latitude and longitude.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await resolveOperatorTerminalAction(terminalId, { lat, lng });
      if (result.error) {
        setError(result.error);
        return;
      }
      setResolvingId(null);
      setLatInput("");
      setLngInput("");
    });
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex justify-between items-center border-b border-black/5 pb-2">
        <div>
          <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
            <MapPin size={15} strokeWidth={2} className="text-county-ink/50" />
            Operator-Submitted Terminals
          </h3>
          <p className="text-xs text-black/50">Designated pick-up/drop-off areas operators have declared, auto-checked against the map.</p>
        </div>
        <span className="badge bg-county-yellow/20 text-yellow-900 font-bold">
          {terminals.filter((t) => t.matchStatus === "UNRESOLVED").length} need confirmation
        </span>
      </div>

      {error && (
        <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-2.5 rounded-lg font-semibold">
          {error}
        </div>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-black/40 border-b border-black/5">
            <th className="pb-1.5 font-bold">Operator</th>
            <th className="pb-1.5 font-bold">Route</th>
            <th className="pb-1.5 font-bold">Declared Terminal</th>
            <th className="pb-1.5 font-bold">Status</th>
            {canResolve && <th className="pb-1.5 font-bold text-right">Action</th>}
          </tr>
        </thead>
        <tbody>
          {terminals.map((t) => (
            <Fragment key={t.id}>
              <tr className="border-b border-black/5 last:border-0">
                <td className="py-2 font-semibold text-county-black">{saccoById.get(t.saccoId)?.name || t.saccoId}</td>
                <td className="py-2 text-black/60">{routeById.get(t.routeId)?.code || t.routeId}</td>
                <td className="py-2 text-black/70">{t.label}</td>
                <td className="py-2">
                  <span className={`badge font-bold ${STATUS_BADGE[t.matchStatus] ?? STATUS_BADGE.PENDING}`}>
                    {t.matchStatus.replace(/_/g, " ")}
                  </span>
                </td>
                {canResolve && (
                  <td className="py-2 text-right">
                    {t.matchStatus === "UNRESOLVED" && (
                      <button
                        type="button"
                        onClick={() => setResolvingId(resolvingId === t.id ? null : t.id)}
                        className="btn-secondary !py-1 !px-2.5 text-[10px] font-bold"
                      >
                        Resolve
                      </button>
                    )}
                  </td>
                )}
              </tr>
              {canResolve && resolvingId === t.id && (
                <tr className="bg-black/[0.015]">
                  <td colSpan={5} className="py-2.5 px-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        value={latInput}
                        onChange={(e) => setLatInput(e.target.value)}
                        placeholder="Latitude"
                        className="input !py-1 text-[10px] w-28"
                      />
                      <input
                        value={lngInput}
                        onChange={(e) => setLngInput(e.target.value)}
                        placeholder="Longitude"
                        className="input !py-1 text-[10px] w-28"
                      />
                      <button
                        type="button"
                        onClick={() => handleResolve(t.id)}
                        disabled={isPending}
                        className="btn-primary !py-1 !px-2.5 text-[10px] font-bold flex items-center gap-1"
                      >
                        <CheckCircle2 size={11} strokeWidth={2.5} />
                        {isPending ? "Saving…" : "Confirm Location"}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
