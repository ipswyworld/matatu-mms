import { FineStatus, MatatuStatus } from "@/lib/types";

const MATATU_STYLES: Record<MatatuStatus, string> = {
  REGISTRATION_PENDING: "bg-blue-100 text-blue-700 font-bold",
  ACTIVE: "bg-county-green/10 text-county-green",
  FLAGGED: "bg-amber-100 text-amber-700",
  IMPOUNDED: "bg-county-red/10 text-county-red",
  DECOMMISSIONED: "bg-black/10 text-black/50",
};

const FINE_STYLES: Record<FineStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  PAID: "bg-county-green/10 text-county-green",
  DISPUTED: "bg-county-red/10 text-county-red",
  WAIVED: "bg-black/10 text-black/50",
};

export function MatatuStatusPill({ status }: { status: MatatuStatus }) {
  const displayStatus = status === "REGISTRATION_PENDING" ? "REGISTRATION PENDING" : status;
  return <span className={`badge ${MATATU_STYLES[status] || "bg-black/10 text-black/50"}`}>{displayStatus}</span>;
}

export function FineStatusPill({ status }: { status: FineStatus }) {
  return <span className={`badge ${FINE_STYLES[status]}`}>{status}</span>;
}
