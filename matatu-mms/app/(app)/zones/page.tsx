import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { getDutyZones, getSectors } from "@/lib/data";
import { readSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";
import ZoneFormModal from "@/components/ZoneFormModal";

export const metadata: Metadata = { title: "Zones" };

export default async function ZonesPage() {
  const session = readSession()!;
  const canManage = can(session.role, "manage_duty_allocation");
  const [zones, sectors] = await Promise.all([getDutyZones(), getSectors()]);

  return (
    <div className="space-y-6">
      <PageBanner
        icon={MapPin}
        eyebrow="Nairobi City County · Enforcement"
        title="Zones"
        subtitle={`${zones.length} enforcement zone${zones.length !== 1 ? "s" : ""}, grouped by sector.`}
        action={canManage && <ZoneFormModal sectors={sectors} />}
      />
      {zones.length === 0 ? (
        <div className="card p-8 text-center text-sm text-black/50">No zones defined yet.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {zones.map((z) => (
            <div key={z.id} className="card p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="shrink-0 h-8 w-8 rounded-lg bg-county-green/10 text-county-green flex items-center justify-center">
                    <MapPin size={16} strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-bold truncate">{z.name}</h3>
                    {z.sectorName && <p className="text-xs text-black/50">Sector {z.sectorCode} — {z.sectorName}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {z.code && <span className="badge bg-black/5 text-county-black font-mono">{z.code}</span>}
                  {z.boundaryGeojson && <span className="badge bg-county-blue/10 text-county-blue">Mapped</span>}
                </div>
              </div>
              {z.description && <p className="text-sm text-black/60 mt-2">{z.description}</p>}
              {canManage && (
                <div className="mt-3 pt-3 border-t border-black/5">
                  <ZoneFormModal sectors={sectors} existing={z} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
