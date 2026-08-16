import type { Metadata } from "next";
import { Route as RouteIcon, Bus, Coins } from "lucide-react";
import { getMatatus, getRoutes } from "@/lib/data";
import { readSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";
import AddRouteModal from "@/components/AddRouteModal";

export const metadata: Metadata = { title: "Route Corridors" };

export default async function RoutesPage() {
  const session = readSession()!;
  const [routes, matatus] = await Promise.all([
    getRoutes(),
    getMatatus(),
  ]);

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Routes"
        title="Route Corridors"
        subtitle={`${routes.length} licensed route corridor${routes.length !== 1 ? "s" : ""} across the matatu network.`}
        action={can(session.role, "manage_routes") && <AddRouteModal />}
      />
      <div className="grid md:grid-cols-2 gap-4">
        {routes.map((r) => {
          const count = matatus.filter((m) => m.routeId === r.id).length;
          return (
            <div key={r.id} className="card p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="shrink-0 h-8 w-8 rounded-lg bg-county-green/10 text-county-green flex items-center justify-center">
                    <RouteIcon size={16} strokeWidth={2} />
                  </span>
                  <h3 className="font-bold truncate">{r.name}</h3>
                </div>
                <span className="badge bg-county-green/10 text-county-green shrink-0">Route {r.code}</span>
              </div>
              <p className="text-sm text-black/60 mt-2">{r.description}</p>
              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-black/40 flex items-center gap-1.5">
                  <Bus size={13} strokeWidth={2} />
                  {count} vehicle{count !== 1 ? "s" : ""} assigned
                </p>
                <span className="text-xs font-bold text-county-black flex items-center gap-1">
                  <Coins size={13} strokeWidth={2} />
                  KES {r.fareKes} / seat
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
