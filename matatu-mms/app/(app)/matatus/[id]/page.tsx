import Link from "next/link";
import { notFound } from "next/navigation";
import { readSession } from "@/lib/session";
import { getActivityForMatatu, getFinesForMatatu, getMatatuById, getRoutes, getSaccos, getUsers } from "@/lib/data";
import { can } from "@/lib/rbac";
import { updateMatatuStatusAction } from "@/lib/actions";
import { MatatuStatusPill, FineStatusPill } from "@/components/StatusPill";
import { MatatuStatus } from "@/lib/types";

export default async function MatatuDetailPage({ params }: { params: { id: string } }) {
  const session = readSession()!;
  
  // Fetch details, lists, and lookup data in parallel
  const [matatu, activityList, finesList, users, saccos, routes] = await Promise.all([
    getMatatuById(params.id),
    getActivityForMatatu(params.id),
    getFinesForMatatu(params.id),
    getUsers(),
    getSaccos(),
    getRoutes(),
  ]);

  if (!matatu) notFound();

  if (session.role === "SACCO_OPERATOR" && matatu.saccoId !== session.saccoId) {
    notFound();
  }

  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const saccoMap = new Map(saccos.map((s) => [s.id, s.name]));
  const routeMap = new Map(routes.map((r) => [r.id, r.name]));

  const activity = activityList.slice().sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  
  const fines = finesList;
  const canEditStatus = can(session.role, "edit_matatu_status");
  const statuses: MatatuStatus[] = ["REGISTRATION_PENDING", "ACTIVE", "FLAGGED", "IMPOUNDED", "DECOMMISSIONED"];

  return (
    <div className="space-y-6">
      <Link href="/matatus" className="text-xs font-semibold text-county-green hover:underline">← Back to registry</Link>

      <div className="card p-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{matatu.regNumber}</h2>
          <p className="text-sm text-black/50 mt-1">
            {saccoMap.get(matatu.saccoId)} · {routeMap.get(matatu.routeId)} · {matatu.capacity} seats
          </p>
          <p className="text-xs text-black/40 mt-1">
            Registered {new Date(matatu.createdAt).toLocaleDateString()} · Segment: <span className="font-semibold text-black/70">{matatu.terminalSegment || "CBD Route Terminal Stage"}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <MatatuStatusPill status={matatu.status} />
          {canEditStatus && (
            <div className="flex flex-wrap gap-2 justify-end">
              {statuses.filter((s) => s !== matatu.status).map((s) => (
                <form key={s} action={updateMatatuStatusAction.bind(null, matatu.id, s)}>
                  <button type="submit" className="btn-secondary !px-2.5 !py-1 text-xs">
                    Mark {s.toLowerCase().replace("_", " ")}
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Activity history</h3>
            {can(session.role, "log_activity") && (
              <Link href={`/activity/new?matatuId=${matatu.id}`} className="text-xs font-semibold text-county-green hover:underline">
                + Log activity
              </Link>
            )}
          </div>
          <div className="space-y-3">
            {activity.length === 0 && <p className="text-sm text-black/40">No activity recorded.</p>}
            {activity.map((a) => (
              <div key={a.id} className="text-sm border-b border-black/5 pb-2 last:border-0">
                <div className="flex justify-between">
                  <span className="badge bg-black/5 text-black/60">{a.type}</span>
                  <span className="text-xs text-black/40">{new Date(a.timestamp).toLocaleString()}</span>
                </div>
                <p className="mt-1">{a.description}</p>
                <p className="text-xs text-black/40">{a.location} · logged by {userMap.get(a.officerId) || "System"}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Fines</h3>
            {can(session.role, "issue_fine") && (
              <Link href={`/fines/new?matatuId=${matatu.id}`} className="text-xs font-semibold text-county-green hover:underline">
                + Issue fine
              </Link>
            )}
          </div>
          <div className="space-y-3">
            {fines.length === 0 && <p className="text-sm text-black/40">No fines on record.</p>}
            {fines.map((f) => (
              <div key={f.id} className="text-sm border-b border-black/5 pb-2 last:border-0">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">KES {f.amountKes.toLocaleString()}</span>
                  <FineStatusPill status={f.status} />
                </div>
                <p className="mt-1">{f.reason}</p>
                <p className="text-xs text-black/40">Issued {new Date(f.issuedAt).toLocaleDateString()} · Due {f.dueDate}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
