import { AlertTriangle } from "lucide-react";
import { getPublicStatus } from "@/lib/data";

/**
 * Site-wide announcer for an upcoming or active maintenance window (Ops
 * Console Rebuild Spec's Phase 8 item). Renders nothing when there's
 * nothing to say — no announcement set and maintenance mode isn't active —
 * so this is invisible on an ordinary day.
 */
export default async function MaintenanceBanner() {
  const status = await getPublicStatus();
  if (!status) return null;

  const announcement = status.maintenanceAnnouncement;
  if (!status.maintenanceActive && !announcement) return null;

  const message =
    (status.maintenanceActive && "The system is currently undergoing maintenance. Some features may be unavailable.") ||
    announcement?.message ||
    (announcement?.scheduledStart && announcement?.scheduledEnd
      ? `Scheduled maintenance from ${new Date(announcement.scheduledStart).toLocaleString()} to ${new Date(announcement.scheduledEnd).toLocaleString()}.`
      : null);

  if (!message) return null;

  return (
    <div className={`px-4 py-2 text-center text-xs font-semibold flex items-center justify-center gap-2 ${status.maintenanceActive ? "bg-county-red text-white" : "bg-amber-100 text-amber-800"}`}>
      <AlertTriangle size={13} className="shrink-0" />
      <span>{message}</span>
    </div>
  );
}
