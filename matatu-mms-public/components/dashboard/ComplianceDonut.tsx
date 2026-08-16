interface ComplianceDonutProps {
  total: number;
  active: number;
  flagged: number;
  impounded: number;
  decommissioned: number;
}

const SIZE = 120;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

const SEGMENTS = [
  { key: "active", label: "Active", color: "#0F5132" },
  { key: "flagged", label: "Flagged", color: "#F5C518" },
  { key: "impounded", label: "Impounded", color: "#B4232C" },
  { key: "decommissioned", label: "Decommissioned", color: "#3E4A44" },
] as const;

export default function ComplianceDonut({ total, active, flagged, impounded, decommissioned }: ComplianceDonutProps) {
  const values: Record<string, number> = { active, flagged, impounded, decommissioned };
  const compliancePct = total > 0 ? Math.round((active / total) * 100) : 0;

  let cumulativeOffset = 0;

  return (
    <div className="rounded-2xl bg-white p-4 md:p-5 shadow-sm ring-1 ring-county-ink/[0.06] flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">Fleet compliance</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">Current status across the registered fleet</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-county-green bg-county-green/10 px-2.5 py-1 rounded-full">
          Live
        </span>
      </div>

      <div className="flex flex-col md:flex-row items-center gap-4 md:gap-5 mt-3 flex-1">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-full -rotate-90">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#F0E9CE" strokeWidth={STROKE} />
            {total > 0 &&
              SEGMENTS.map((seg) => {
                const val = values[seg.key];
                if (val === 0) return null;
                const arc = (val / total) * C;
                const el = (
                  <circle
                    key={seg.key}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={STROKE}
                    strokeDasharray={`${arc} ${C}`}
                    strokeDashoffset={-cumulativeOffset}
                    strokeLinecap="butt"
                  />
                );
                cumulativeOffset += arc;
                return el;
              })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
            <span className="text-[26px] font-black tracking-tight text-county-ink leading-none">{compliancePct}%</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-county-ink/50 mt-1">Compliant</span>
            <span className="text-[10px] text-county-ink/60">{total} vehicles</span>
          </div>
        </div>

        <ul className="flex-1 w-full space-y-2.5 min-w-0">
          {SEGMENTS.map((seg) => {
            const val = values[seg.key];
            const pct = total > 0 ? Math.round((val / total) * 100) : 0;
            return (
              <li key={seg.key} className="flex items-center gap-3">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="text-sm font-semibold text-county-ink/80 flex-1 truncate">{seg.label}</span>
                <span className="text-sm font-black tabular-nums text-county-ink">{val}</span>
                <span className="text-[11px] font-bold text-county-ink/40 tabular-nums w-9 text-right">{pct}%</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
