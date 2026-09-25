import type { Metadata } from "next";
import { Activity, CheckCircle2, XCircle } from "lucide-react";
import { getPublicStatus } from "@/lib/data";
import PublicLegalLayout from "@/components/PublicLegalLayout";

export const metadata: Metadata = {
  title: "System Status",
  description: "Live status of Mji-Move's core services.",
};

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const status = await getPublicStatus();

  return (
    <PublicLegalLayout
      icon={Activity}
      eyebrow="Nairobi City County · System Status"
      title="System Status"
      subtitle="Live status of Mji-Move's core services — no account needed to check this page."
    >
      {!status ? (
        <p className="text-sm text-county-ink/60">Could not reach the status service. Please try again shortly.</p>
      ) : (
        <div className="space-y-6">
          {status.maintenanceActive && (
            <div className="rounded-xl border border-county-red/20 bg-county-red/5 p-4 text-sm text-county-red font-semibold">
              The system is currently undergoing maintenance. Some features may be unavailable.
            </div>
          )}

          {status.maintenanceAnnouncement && !status.maintenanceActive && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {status.maintenanceAnnouncement.message ||
                (status.maintenanceAnnouncement.scheduledStart && status.maintenanceAnnouncement.scheduledEnd
                  ? `Scheduled maintenance from ${new Date(status.maintenanceAnnouncement.scheduledStart).toLocaleString()} to ${new Date(status.maintenanceAnnouncement.scheduledEnd).toLocaleString()}.`
                  : "A maintenance window has been scheduled.")}
            </div>
          )}

          <div className="space-y-2">
            {status.services.map((s) => (
              <div key={s.name} className="flex items-center justify-between p-3 rounded-lg border border-county-ink/10">
                <span className="font-semibold text-county-ink">{s.name}</span>
                <span className={`flex items-center gap-1.5 text-xs font-bold ${s.up ? "text-county-green" : "text-county-red"}`}>
                  {s.up ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {s.up ? "Operational" : "Down"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PublicLegalLayout>
  );
}
