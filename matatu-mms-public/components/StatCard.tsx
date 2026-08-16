import type { LucideIcon } from "lucide-react";

export default function StatCard({
  label,
  value,
  accent = "green",
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  accent?: "green" | "red" | "black";
  hint?: string;
  icon?: LucideIcon;
}) {
  const accentClass = {
    green: "text-county-green",
    red: "text-county-red",
    black: "text-county-black",
  }[accent];

  const washClass = {
    green: "bg-county-green/[0.03] border-county-green/10",
    red: "bg-county-red/[0.03] border-county-red/10",
    black: "border-black/5",
  }[accent];

  const iconWashClass = {
    green: "bg-county-green/10 text-county-green",
    red: "bg-county-red/10 text-county-red",
    black: "bg-black/[0.06] text-county-black/60",
  }[accent];

  return (
    <div className={`card p-5 border ${washClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-black/45">{label}</div>
        {Icon && (
          <span className={`shrink-0 h-7 w-7 rounded-lg flex items-center justify-center ${iconWashClass}`}>
            <Icon size={14} strokeWidth={2} />
          </span>
        )}
      </div>
      <div className={`text-4xl font-black mt-1.5 tracking-tight ${accentClass}`}>{value}</div>
      {hint && <div className="text-xs text-black/40 mt-1.5">{hint}</div>}
    </div>
  );
}
