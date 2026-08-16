import { Clock, CheckCircle2, AlertTriangle, Ban, Archive, AlertCircle, CircleSlash, type LucideIcon } from "lucide-react";
import { FineStatus, MatatuStatus } from "@/lib/types";

const MATATU_STYLES: Record<MatatuStatus, string> = {
  REGISTRATION_PENDING: "bg-blue-100 text-blue-700 font-bold",
  ACTIVE: "bg-county-green/10 text-county-green",
  FLAGGED: "bg-amber-100 text-amber-700",
  IMPOUNDED: "bg-county-red/10 text-county-red",
  DECOMMISSIONED: "bg-black/10 text-black/50",
};

const MATATU_ICONS: Record<MatatuStatus, LucideIcon> = {
  REGISTRATION_PENDING: Clock,
  ACTIVE: CheckCircle2,
  FLAGGED: AlertTriangle,
  IMPOUNDED: Ban,
  DECOMMISSIONED: Archive,
};

const FINE_STYLES: Record<FineStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  PAID: "bg-county-green/10 text-county-green",
  DISPUTED: "bg-county-red/10 text-county-red",
  WAIVED: "bg-black/10 text-black/50",
};

const FINE_ICONS: Record<FineStatus, LucideIcon> = {
  PENDING: Clock,
  PAID: CheckCircle2,
  DISPUTED: AlertCircle,
  WAIVED: CircleSlash,
};

export function MatatuStatusPill({ status }: { status: MatatuStatus }) {
  const displayStatus = status === "REGISTRATION_PENDING" ? "REGISTRATION PENDING" : status;
  const Icon = MATATU_ICONS[status];
  return (
    <span className={`badge inline-flex items-center gap-1 ${MATATU_STYLES[status] || "bg-black/10 text-black/50"}`}>
      {Icon && <Icon size={11} strokeWidth={2.5} />}
      {displayStatus}
    </span>
  );
}

export function FineStatusPill({ status }: { status: FineStatus }) {
  const Icon = FINE_ICONS[status];
  return (
    <span className={`badge inline-flex items-center gap-1 ${FINE_STYLES[status]}`}>
      {Icon && <Icon size={11} strokeWidth={2.5} />}
      {status}
    </span>
  );
}
