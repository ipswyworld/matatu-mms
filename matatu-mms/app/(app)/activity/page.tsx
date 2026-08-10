import Link from "next/link";
import { readSession } from "@/lib/session";
import { getActivity, getMatatus, getUsers } from "@/lib/data";
import { can } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";

export default async function ActivityPage() {
  const session = readSession()!;
  const isSacco = session.role === "SACCO_OPERATOR";

  // Fetch data in parallel (concurrency)
  const [allMatatus, allActivities, users] = await Promise.all([
    getMatatus(),
    getActivity(),
    getUsers(),
  ]);

  const matatuMap = new Map(allMatatus.map((m) => [m.id, m]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  const myMatatuIds = new Set(allMatatus.filter((m) => m.saccoId === session.saccoId).map((m) => m.id));

  const activity = allActivities
    .filter((a) => !isSacco || myMatatuIds.has(a.matatuId))
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-4">
      <PageBanner
        eyebrow="Nairobi City County · Field Records"
        title="Activity Log"
        subtitle={`${activity.length} logged event${activity.length !== 1 ? "s" : ""} — trips, inspections, and incidents recorded by crew and officers.`}
        action={
          can(session.role, "log_activity") && (
            <Link href="/activity/new" className="rounded-lg px-3.5 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors">
              + Log activity
            </Link>
          )
        }
      />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Vehicle</th>
              <th>Type</th>
              <th>Location</th>
              <th>Description</th>
              <th>Officer</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((a) => {
              const m = matatuMap.get(a.matatuId);
              return (
                <tr key={a.id}>
                  <td className="text-xs text-black/50">{new Date(a.timestamp).toLocaleString()}</td>
                  <td>
                    <Link href={`/matatus/${a.matatuId}`} className="font-semibold text-county-green hover:underline">
                      {m?.regNumber || "Unknown"}
                    </Link>
                  </td>
                  <td><span className="badge bg-black/5 text-black/60">{a.type}</span></td>
                  <td>{a.location}</td>
                  <td>{a.description}</td>
                  <td>{userMap.get(a.officerId) || "System"}</td>
                </tr>
              );
            })}
            {activity.length === 0 && (
              <tr><td colSpan={6} className="text-center text-black/40 py-8">No activity logged yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
