"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X, ArrowRight } from "lucide-react";
import { MatatuStatusPill } from "./StatusPill";
import { Matatu, Route, Sacco } from "@/lib/types";

interface FleetFilterTableProps {
  matatus: Matatu[];
  routes: Route[];
  saccos: Sacco[];
  isSacco: boolean;
}

export default function FleetFilterTable({ matatus, routes, saccos, isSacco }: FleetFilterTableProps) {
  const [query, setQuery] = useState("");
  const [routeId, setRouteId] = useState("");
  const [saccoId, setSaccoId] = useState("");

  const saccoMap = useMemo(() => new Map(saccos.map((s) => [s.id, s.name])), [saccos]);
  const routeMap = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);

  const filtered = useMemo(() => {
    // `matatus` is already scoped to the operator's own fleet server-side
    // when isSacco — the operator filter UI only exists for non-operators.
    const q = query.toUpperCase().trim();
    return matatus.filter((m) => {
      const matchesSacco = !saccoId || m.saccoId === saccoId;
      const matchesQuery = !q || m.regNumber.includes(q);
      const matchesRoute = !routeId || m.routeId === routeId;
      return matchesSacco && matchesQuery && matchesRoute;
    });
  }, [matatus, saccoId, query, routeId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-end bg-black/5 p-4 rounded-lg">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-black/50 block mb-1">Search Plate Number</label>
          <div className="relative">
            <Search size={14} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-black/30 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. KDA 112B"
              className="w-full text-sm border border-black/10 rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
            />
          </div>
        </div>
        <div className="w-56 shrink-0">
          <label className="text-xs font-semibold text-black/50 block mb-1">Filter by Route</label>
          <select
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            className="w-full text-sm border border-black/10 rounded px-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
          >
            <option value="">All Routes</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                Route {r.code} - {r.name}
              </option>
            ))}
          </select>
        </div>
        {!isSacco && (
          <div className="w-56 shrink-0">
            <label className="text-xs font-semibold text-black/50 block mb-1">Filter by Operator</label>
            <select
              value={saccoId}
              onChange={(e) => setSaccoId(e.target.value)}
              className="w-full text-sm border border-black/10 rounded px-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
            >
              <option value="">All Operators</option>
              {saccos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {(query || routeId || saccoId) && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setRouteId("");
              setSaccoId("");
            }}
            className="btn-secondary !py-1.5 shrink-0 flex items-center gap-1"
          >
            <X size={13} strokeWidth={2} />
            Clear
          </button>
        )}
        <span className="text-xs font-semibold text-black/40 self-center">
          {filtered.length} of {matatus.length}
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Reg. Number</th>
              {!isSacco && <th>Operator</th>}
              <th>Route Corridor</th>
              <th>Terminal & Stage Segment</th>
              <th>Capacity</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const saccoName = saccoMap.get(m.saccoId) || "Unknown Operator";
              const defaultTerminal = `${saccoName}: CBD-Umoja Terminal: Tusker Stage`;
              return (
                <tr key={m.id}>
                  <td className="font-bold text-county-black">{m.regNumber}</td>
                  {!isSacco && <td>{saccoName}</td>}
                  <td>{routeMap.get(m.routeId) || "Unknown Route"}</td>
                  <td className="text-xs font-medium text-black/70">
                    <span className="bg-black/5 px-2 py-1 rounded border border-black/5">
                      {m.terminalSegment || defaultTerminal}
                    </span>
                  </td>
                  <td>{m.capacity} seats</td>
                  <td><MatatuStatusPill status={m.status} /></td>
                  <td>
                    <Link href={`/matatus/${m.id}`} className="text-xs font-bold text-county-green hover:underline inline-flex items-center gap-1">
                      Details
                      <ArrowRight size={12} strokeWidth={2.5} />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isSacco ? 6 : 7} className="text-center text-black/40 py-8">No vehicles matching your criteria.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
