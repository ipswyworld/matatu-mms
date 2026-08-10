export default function StatCard({
  label,
  value,
  accent = "green",
  hint,
}: {
  label: string;
  value: string | number;
  accent?: "green" | "red" | "black";
  hint?: string;
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

  return (
    <div className={`card p-5 border ${washClass}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-black/45">{label}</div>
      <div className={`text-4xl font-black mt-1.5 tracking-tight ${accentClass}`}>{value}</div>
      {hint && <div className="text-xs text-black/40 mt-1.5">{hint}</div>}
    </div>
  );
}
