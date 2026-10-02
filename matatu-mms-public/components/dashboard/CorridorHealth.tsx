import Link from "next/link";
import { Fine, Matatu, Route } from "@/lib/types";

interface CorridorHealthProps {
  routes: Route[];
  matatus: Matatu[];
  fines: Fine[];
}

/**
 * Per-route health: vehicle count, active/flagged mix, pending fine value.
 * The dashboard's "current state of the network" story.
 */
export default function CorridorHealth({ routes, matatus, fines }: CorridorHealthProps) {
  const rows = routes.map((r) => {
    const routeMatatus = matatus.filter((m) => m.routeId === r.id);
    const active = routeMatatus.filter((m) => m.status === "ACTIVE").length;
    const flagged = routeMatatus.filter((m) => m.status === "FLAGGED" || m.status === "IMPOUNDED").length;
    const routeMatatuIds = new Set(routeMatatus.map((m) => m.id));
    const pendingFines = fines.filter((f) => f.status === "PENDING" && routeMatatuIds.has(f.matatuId));
    const pendingValue = pendingFines.reduce((sum, f) => sum + f.amountKes, 0);
    const compliancePct = routeMatatus.length > 0 ? Math.round((active / routeMatatus.length) * 100) : 0;
    return { route: r, count: routeMatatus.length, active, flagged, pendingValue, compliancePct };
  });

  return (
    <div className="rounded-2xl bg-white p-5 md:p-6 shadow-sm ring-1 ring-county-ink/[0.06]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">Route corridor health</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">Per-corridor compliance and outstanding fines</p>
        </div>
        <Link href="/routes" className="text-xs font-bold text-county-green hover:underline">
          Manage routes →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-county-ink/40 py-8 text-center">No routes configured yet.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {rows.map(({ route, count, active, flagged, pendingValue, compliancePct }) => {
            const healthy = flagged === 0;
            return (
              <div
                key={route.id}
                className="rounded-xl bg-county-cream/60 p-4 ring-1 ring-county-ink/[0.05] hover:ring-county-green/40 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-county-green/10 text-county-green">Route {route.code}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-county-ink/45">
                        KES {route.fareKes} / seat
                      </span>
                    </div>
                    <h4 className="font-black text-county-ink text-sm mt-2 truncate">{route.name}</h4>
                    <p className="text-[11px] text-county-ink/55 truncate">{route.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-2xl font-black tabular-nums leading-none ${healthy ? "text-county-green" : "text-county-yellow-dark"}`}>
                      {compliancePct}%
                    </div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-county-ink/45 mt-1">
                      Compliant
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-county-ink/[0.05] flex items-center justify-between text-[12px]">
                  <span className="text-county-ink/55">
                    <span className="font-bold text-county-ink">{active}</span> active · <span className={flagged > 0 ? "font-bold text-county-yellow-dark" : "text-county-ink/40"}>{flagged}</span> flagged
                  </span>
                  {pendingValue > 0 ? (
                    <span className="font-bold text-county-red">KES {(pendingValue / 1000).toFixed(0)}k pending</span>
                  ) : (
                    <span className="text-county-ink/40">No outstanding fines</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
