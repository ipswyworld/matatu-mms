interface BarDatum {
  label: string;
  value: number;
  colorClass: string;
}

export default function RevenueBarChart({ data, title }: { data: BarDatum[]; title: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="card p-5 space-y-4">
      <h3 className="font-bold text-sm text-county-black">{title}</h3>
      <div className="space-y-3">
        {data.map((d) => (
          <div key={d.label} className="space-y-1">
            <div className="flex justify-between items-baseline text-xs">
              <span className="font-semibold text-black/70">{d.label}</span>
              <span className="font-bold text-county-black">KES {d.value.toLocaleString()}</span>
            </div>
            <div className="h-2.5 rounded-full bg-black/5 overflow-hidden">
              <div
                className={`h-full rounded-full ${d.colorClass} transition-[width] duration-500 ease-out`}
                style={{ width: `${Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
