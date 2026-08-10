interface RevenueBarsProps {
  paid: number;
  pending: number;
  disputed: number;
  waived: number;
  collectionRate: number;
}

const BARS = [
  { key: "paid", label: "Paid", color: "#0F5132", tone: "text-county-green" },
  { key: "pending", label: "Pending", color: "#F5C518", tone: "text-county-yellow-dark" },
  { key: "disputed", label: "Disputed", color: "#B4232C", tone: "text-county-red" },
  { key: "waived", label: "Waived", color: "#8A9691", tone: "text-county-ink/50" },
] as const;

const formatKes = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
};

export default function RevenueBars({ paid, pending, disputed, waived, collectionRate }: RevenueBarsProps) {
  const values: Record<string, number> = { paid, pending, disputed, waived };
  const max = Math.max(paid, pending, disputed, waived, 1);
  const totalIssued = paid + pending + disputed + waived;

  return (
    <div className="rounded-2xl bg-white p-5 md:p-6 shadow-sm ring-1 ring-county-ink/[0.06] flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">Fine revenue</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">KES by settlement status</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-county-ink/50">Collection rate</div>
          <div className={`text-xl font-black tabular-nums ${collectionRate >= 60 ? "text-county-green" : "text-county-yellow-dark"}`}>
            {collectionRate}%
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-end gap-4 mt-6 min-h-[180px]">
        {BARS.map((bar) => {
          const val = values[bar.key];
          const heightPct = (val / max) * 100;
          return (
            <div key={bar.key} className="flex-1 flex flex-col items-center gap-2 min-w-0">
              <div className={`text-xs font-black tabular-nums ${bar.tone}`}>KES {formatKes(val)}</div>
              <div
                className="w-full rounded-t-md transition-all duration-500 relative overflow-hidden"
                style={{
                  height: `${Math.max(heightPct, 3)}%`,
                  backgroundColor: bar.color,
                  minHeight: val > 0 ? 8 : 3,
                }}
              >
                {val > 0 && (
                  <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-white/25 to-transparent" />
                )}
              </div>
              <div className="text-[11px] font-bold text-county-ink/60 uppercase tracking-wider">{bar.label}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-county-ink/5 text-[11px] text-county-ink/55 flex justify-between">
        <span>Total issued</span>
        <span className="font-bold tabular-nums text-county-ink/80">KES {totalIssued.toLocaleString()}</span>
      </div>
    </div>
  );
}
