import { DutyStatus } from "@/lib/types";

// The sheet's "ON DUTY (OFF DUTY & LEAVE SPECIFY DATES)" column, as a pill.
// ON_DUTY is deliberately the quietest of the six: it is the default state
// of almost every row, and colouring it would make the exceptions — the
// ones a commander is actually scanning for — harder to pick out.
const STYLES: Record<DutyStatus, { label: string; className: string }> = {
  ON_DUTY: { label: "On duty", className: "bg-county-green/10 text-county-green" },
  OFF_DUTY: { label: "Off duty", className: "bg-black/[0.06] text-black/50" },
  LEAVE: { label: "Leave", className: "bg-county-yellow/20 text-county-yellow-dark" },
  SICK: { label: "Sick", className: "bg-amber-100 text-amber-800" },
  SUSPENDED: { label: "Suspended", className: "bg-county-red/10 text-county-red" },
  TRAINING: { label: "Training", className: "bg-blue-50 text-blue-700" },
};

export default function DutyStatusPill({ status }: { status: DutyStatus }) {
  const style = STYLES[status] || STYLES.ON_DUTY;
  return (
    <span className={`badge text-[9px] font-extrabold ${style.className}`}>{style.label}</span>
  );
}
