import { getMatatus, getRoutes } from "@/lib/data";
import { readSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";
import AddRouteModal from "@/components/AddRouteModal";

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
              <div className="flex items-center justify-between">
                <h3 className="font-bold">{r.name}</h3>
                <span className="badge bg-county-green/10 text-county-green">Route {r.code}</span>
              </div>
              <p className="text-sm text-black/60 mt-2">{r.description}</p>
              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-black/40">{count} vehicle{count !== 1 ? "s" : ""} assigned</p>
                <span className="text-xs font-bold text-county-black">KES {r.fareKes} / seat</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
