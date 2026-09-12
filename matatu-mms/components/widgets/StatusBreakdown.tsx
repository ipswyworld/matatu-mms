export interface StatusSegment {
  key: string;
  label: string;
  color: string;
  value: number;
}

export interface StatusBreakdownProps {
  title: string;
  subtitle?: string;
  segments: StatusSegment[];
  /** "donut" (a ring + center %, e.g. fleet compliance) or "bar" (vertical
   * bars per segment, e.g. revenue by settlement status). Default "donut". */
  variant?: "donut" | "bar";
  valueFormat?: "currency" | "number";
  valueFormatter?: (n: number) => string;
  /** Donut only — label under the center percentage, e.g. "Compliant". */
  centerMetricLabel?: string;
  /** Donut only — unit noun after the total, e.g. "{total} vehicles". */
  totalUnitLabel?: string;
  /** Small pill/stat in the header — "Live" badge on the donut, or
   * "Collection rate: 82%" on the bar variant. */
  headerStat?: { label: string; value: string; tone?: "positive" | "attention" | "negative" };
  /** Bar variant only — summary row under the bars, e.g. "Total issued". */
  footerStat?: { label: string; value: string };
}

const SIZE = 120;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

const TONE_CLASS: Record<string, string> = {
  positive: "text-county-green bg-county-green/10",
  attention: "text-county-yellow-dark bg-county-yellow/20",
  negative: "text-county-red bg-county-red/10",
};

const defaultFormatter = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : n.toString());
const currencyFormatter = (n: number) => `KES ${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : n.toString()}`;

/**
 * Generic status/category breakdown widget (ADMIN_DASHBOARD_AUDIT §5.1) —
 * unifies what used to be two near-identical one-offs: ComplianceDonut
 * (donut variant) and RevenueBars (bar variant). Same segment shape
 * `{key,label,color,value}` drives both renderings.
 */
export default function StatusBreakdown({
  title,
  subtitle,
  segments,
  variant = "donut",
  valueFormat,
  valueFormatter,
  centerMetricLabel,
  totalUnitLabel,
  headerStat,
  footerStat,
}: StatusBreakdownProps) {
  const activeFormatter = valueFormat === "currency" ? currencyFormatter : (valueFormatter || defaultFormatter);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="rounded-2xl bg-white p-4 md:p-5 shadow-sm ring-1 ring-county-ink/[0.06] flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">{title}</h3>
          {subtitle && <p className="text-[11px] text-county-ink/50 mt-1">{subtitle}</p>}
        </div>
        {headerStat && (
          variant === "donut" ? (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${TONE_CLASS[headerStat.tone || "positive"]}`}>
              {headerStat.value}
            </span>
          ) : (
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-county-ink/50">{headerStat.label}</div>
              <div className={`text-xl font-black tabular-nums ${headerStat.tone === "attention" ? "text-county-yellow-dark" : headerStat.tone === "negative" ? "text-county-red" : "text-county-green"}`}>
                {headerStat.value}
              </div>
            </div>
          )
        )}
      </div>

      {variant === "donut" ? (
        <DonutBody segments={segments} total={total} centerMetricLabel={centerMetricLabel} totalUnitLabel={totalUnitLabel} />
      ) : (
        <BarBody segments={segments} valueFormatter={activeFormatter} />
      )}

      {footerStat && (
        <div className="mt-4 pt-4 border-t border-county-ink/5 text-[11px] text-county-ink/55 flex justify-between">
          <span>{footerStat.label}</span>
          <span className="font-bold tabular-nums text-county-ink/80">{footerStat.value}</span>
        </div>
      )}
    </div>
  );
}

function DonutBody({ segments, total, centerMetricLabel, totalUnitLabel }: { segments: StatusSegment[]; total: number; centerMetricLabel?: string; totalUnitLabel?: string }) {
  const primaryPct = total > 0 && segments[0] ? Math.round((segments[0].value / total) * 100) : 0;
  let cumulativeOffset = 0;

  return (
    <div className="flex flex-col md:flex-row items-center gap-4 md:gap-5 mt-3 flex-1">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-full -rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#F0E9CE" strokeWidth={STROKE} />
          {total > 0 &&
            segments.map((seg) => {
              if (seg.value === 0) return null;
              const arc = (seg.value / total) * C;
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
          <span className="text-[26px] font-black tracking-tight text-county-ink leading-none">{primaryPct}%</span>
          {centerMetricLabel && <span className="text-[9px] font-bold uppercase tracking-widest text-county-ink/50 mt-1">{centerMetricLabel}</span>}
          {totalUnitLabel && <span className="text-[10px] text-county-ink/60">{total} {totalUnitLabel}</span>}
        </div>
      </div>

      <ul className="flex-1 w-full space-y-2.5 min-w-0">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
          return (
            <li key={seg.key} className="flex items-start gap-3">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0 mt-1" style={{ backgroundColor: seg.color }} />
              {/* Wraps rather than truncates: a label cut to "Dec..." tells
                  the reader nothing, and there's vertical room to spare. */}
              <span className="text-sm font-semibold text-county-ink/80 flex-1">{seg.label}</span>
              <span className="text-sm font-black tabular-nums text-county-ink shrink-0">{seg.value}</span>
              <span className="text-[11px] font-bold text-county-ink/40 tabular-nums w-9 text-right shrink-0">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BarBody({ segments, valueFormatter }: { segments: StatusSegment[]; valueFormatter: (n: number) => string }) {
  const max = Math.max(...segments.map((s) => s.value), 1);

  return (
    <div className="flex-1 flex items-end gap-3 mt-3 min-h-[110px]">
      {segments.map((seg) => {
        const heightPct = (seg.value / max) * 100;
        return (
          <div key={seg.key} className="flex-1 flex flex-col items-center gap-2 min-w-0">
            <div className="text-xs font-black tabular-nums" style={{ color: seg.color }}>{valueFormatter(seg.value)}</div>
            <div
              className="w-full rounded-t-md transition-all duration-500 relative overflow-hidden"
              style={{
                height: `${Math.max(heightPct, 3)}%`,
                backgroundColor: seg.color,
                minHeight: seg.value > 0 ? 8 : 3,
              }}
            >
              {seg.value > 0 && <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-white/25 to-transparent" />}
            </div>
            <div className="text-[10px] font-bold text-county-ink/60 uppercase tracking-wide whitespace-nowrap">{seg.label}</div>
          </div>
        );
      })}
    </div>
  );
}
