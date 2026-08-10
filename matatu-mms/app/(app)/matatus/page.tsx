import Link from "next/link";
import { readSession } from "@/lib/session";
import { getMatatus, getRoutes, getSaccos } from "@/lib/data";
import { can } from "@/lib/rbac";
import { MatatuStatusPill } from "@/components/StatusPill";
import PageBanner from "@/components/PageBanner";

export default async function MatatusPage({
  searchParams,
}: {
  searchParams: { q?: string; routeId?: string };
}) {
  const session = readSession()!;
  const isSacco = session.role === "SACCO_OPERATOR";

  // Fetch data in parallel
  const [allMatatus, saccos, routes] = await Promise.all([
    getMatatus(),
    getSaccos(),
    getRoutes(),
  ]);

  const saccoMap = new Map(saccos.map((s) => [s.id, s.name]));
  const routeMap = new Map(routes.map((r) => [r.id, r.name]));

  // Server-side filtering using query params
  const q = (searchParams.q || "").toUpperCase().trim();
  const routeId = searchParams.routeId || "";

  const matatus = allMatatus.filter((m) => {
    const matchesSacco = !isSacco || m.saccoId === session.saccoId;
    const matchesQuery = !q || m.regNumber.includes(q);
    const matchesRoute = !routeId || m.routeId === routeId;
    return matchesSacco && matchesQuery && matchesRoute;
  });

  return (
    <div className="space-y-4">
      <PageBanner
        eyebrow="Nairobi City County · Fleet Registry"
        title="Operator Fleet Registry"
        subtitle={`${matatus.length} vehicle${matatus.length !== 1 ? "s" : ""} registered across Nairobi County routes.`}
        action={
          can(session.role, "add_matatu") && (
            <Link href="/matatus/new" className="rounded-lg px-3.5 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors">
              + Onboard New Vehicle
            </Link>
          )
        }
      />

      {/* Advanced Search & Filtering form (Zero-JS HTML GET) */}
      <form method="GET" className="flex flex-wrap gap-4 items-end bg-black/5 p-4 rounded-lg mb-4">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-black/50 block mb-1">Search Plate Number</label>
          <input
            type="text"
            name="q"
            defaultValue={searchParams.q || ""}
            placeholder="e.g. KDA 112B"
            className="w-full text-sm border border-black/10 rounded px-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
          />
        </div>
        <div className="w-56 shrink-0">
          <label className="text-xs font-semibold text-black/50 block mb-1">Filter by Route</label>
          <select
            name="routeId"
            defaultValue={searchParams.routeId || ""}
            className="w-full text-sm border border-black/10 rounded px-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
          >
            <option value="">All Routes</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                Route {r.code} - {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="submit" className="btn-primary !py-1.5">Apply Filters</button>
          <a href="/matatus" className="btn-secondary !py-1.5 text-center">Clear</a>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Reg. Number</th>
              <th>Sacco Operator</th>
              <th>Route Corridor</th>
              <th>Terminal & Stage Segment</th>
              <th>Capacity</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {matatus.map((m) => {
              const saccoName = saccoMap.get(m.saccoId) || "Unknown Sacco";
              const defaultTerminal = `${saccoName}: CBD-Umoja Terminal: Tusker Stage`;
              return (
                <tr key={m.id}>
                  <td className="font-bold text-county-black">{m.regNumber}</td>
                  <td>{saccoName}</td>
                  <td>{routeMap.get(m.routeId) || "Unknown Route"}</td>
                  <td className="text-xs font-medium text-black/70">
                    <span className="bg-black/5 px-2 py-1 rounded border border-black/5">
                      {m.terminalSegment || defaultTerminal}
                    </span>
                  </td>
                  <td>{m.capacity} seats</td>
                  <td><MatatuStatusPill status={m.status} /></td>
                  <td>
                    <Link href={`/matatus/${m.id}`} className="text-xs font-bold text-county-green hover:underline">
                      Details →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {matatus.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-black/40 py-8">No vehicles matching your criteria.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
