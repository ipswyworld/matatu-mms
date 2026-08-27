import { BarChart3, Route as RouteIcon } from "lucide-react";
import type { BoardingHeatmapPoint, ODMatrixCell } from "@/lib/types";

/**
 * Surfaces backend/app/routes/demand.py's OD matrix + boarding heatmap —
 * built during the demand-intelligence work but never actually wired into
 * a screen until now. Both are citywide planning signals (which stages see
 * the most activity, which stage-pairs get searched/booked together), not
 * per-vehicle or per-Sacco data, so this reads the same for every role
 * that reaches the dashboard rather than being scoped like the fleet
 * panels around it.
 */
export default function DemandIntelligence({
  odMatrix,
  boardingHeatmap,
}: {
  odMatrix: ODMatrixCell[];
  boardingHeatmap: BoardingHeatmapPoint[];
}) {
  const topStages = boardingHeatmap.slice(0, 8);
  const maxActivity = Math.max(1, ...topStages.map((s) => s.activityCount));

  const topPairs = odMatrix
    .slice()
    .sort((a, b) => b.searchCount + b.bookingCount - (a.searchCount + a.bookingCount))
    .slice(0, 8);

  return (
    <div className="grid sm:grid-cols-2 gap-4 md:gap-6">
      <div className="rounded-2xl bg-white p-5 md:p-6 shadow-sm ring-1 ring-county-ink/[0.06]">
        <div className="mb-4">
          <h3 className="font-black text-county-ink text-base tracking-tight flex items-center gap-1.5">
            <BarChart3 size={14} strokeWidth={2.5} className="text-county-green" />
            Busiest boarding stages
          </h3>
          <p className="text-[11px] text-county-ink/50 mt-1">Where passenger search &amp; booking activity concentrates — last 30 days</p>
        </div>

        {topStages.length === 0 ? (
          <p className="text-sm text-county-ink/40 py-6 text-center">No demand data recorded in the last 30 days.</p>
        ) : (
          <ul className="space-y-2.5">
            {topStages.map((s, i) => (
              <li key={s.stageId} className="flex items-center gap-3">
                <span className="text-[10px] font-black text-county-ink/30 w-4 shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-bold text-county-ink truncate">{s.stageName}</span>
                    <span className="text-[10px] font-semibold text-county-ink/45 shrink-0">{s.activityCount}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-county-cream overflow-hidden">
                    <div
                      className="h-full rounded-full bg-county-green"
                      style={{ width: `${Math.max(4, (s.activityCount / maxActivity) * 100)}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl bg-white p-5 md:p-6 shadow-sm ring-1 ring-county-ink/[0.06]">
        <div className="mb-4">
          <h3 className="font-black text-county-ink text-base tracking-tight flex items-center gap-1.5">
            <RouteIcon size={14} strokeWidth={2.5} className="text-county-blue" />
            Top origin → destination pairs
          </h3>
          <p className="text-[11px] text-county-ink/50 mt-1">Where people actually want to go — searches plus real bookings</p>
        </div>

        {topPairs.length === 0 ? (
          <p className="text-sm text-county-ink/40 py-6 text-center">No search or booking activity recorded in the last 30 days.</p>
        ) : (
          <ul className="space-y-2">
            {topPairs.map((p) => (
              <li key={`${p.fromStageId}-${p.toStageId}`} className="rounded-xl bg-county-cream/60 ring-1 ring-county-ink/[0.05] p-2.5">
                <span className="text-xs font-extrabold text-county-ink truncate block">
                  {p.fromStageName} <span className="text-county-ink/40 font-semibold">&rarr;</span> {p.toStageName}
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-bold text-county-ink/50">{p.searchCount} searched</span>
                  <span className="text-county-ink/20">&middot;</span>
                  <span className="text-[10px] font-bold text-county-green">{p.bookingCount} booked</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
