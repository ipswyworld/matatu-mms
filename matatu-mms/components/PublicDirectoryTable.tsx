import Link from "next/link";
import { Bus } from "lucide-react";
import { ROLE_LABELS } from "@/lib/rbac";
import { Sacco, User } from "@/lib/types";

const ROLE_BADGE: Record<string, string> = {
  SACCO_OPERATOR: "bg-county-blue/10 text-county-blue",
  CREW: "bg-county-green/10 text-county-green",
  PASSENGER: "bg-black/5 text-black/60",
};

// Read-only by design — each of these account types has its own real
// management workflow (operator verification hub, the operator's own
// crew roster, self-registration), so there is deliberately no edit
// affordance here. See STAFF_ROLES / the "Users & Roles" split.
export default function PublicDirectoryTable({ users, saccos }: { users: User[]; saccos: Sacco[] }) {
  const saccoNameById = new Map(saccos.map((s) => [s.id, s.name]));

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-county-black">Public Directory</h3>
        <Link href="/saccos/verify" className="text-xs font-semibold text-county-green hover:underline inline-flex items-center gap-1">
          <Bus size={12} strokeWidth={2.5} />
          Sacco verification hub →
        </Link>
      </div>
      <p className="text-xs text-black/50">
        Operator, Crew, and Passenger accounts — view only. Each is managed through its own real workflow, not edited here.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
            <tr>
              <th className="p-2.5">Name</th>
              <th className="p-2.5">Contact</th>
              <th className="p-2.5">Role</th>
              <th className="p-2.5">Operator</th>
              <th className="p-2.5">Managed At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-black/[0.02]">
                <td className="p-2.5 font-bold text-county-black">{u.name}</td>
                <td className="p-2.5 text-black/60">{u.email || u.phone || "—"}</td>
                <td className="p-2.5">
                  <span className={`badge font-bold ${ROLE_BADGE[u.role] || "bg-black/5 text-black/60"}`}>{ROLE_LABELS[u.role]}</span>
                </td>
                <td className="p-2.5">{u.saccoId ? saccoNameById.get(u.saccoId) || "—" : "—"}</td>
                <td className="p-2.5 text-black/50">
                  {u.role === "SACCO_OPERATOR" && (
                    <Link href="/saccos/verify" className="text-county-green hover:underline font-semibold">Verification hub</Link>
                  )}
                  {u.role === "CREW" && (
                    <Link href="/saccos/verify" className="text-county-green hover:underline font-semibold">Operator's crew roster</Link>
                  )}
                  {u.role === "PASSENGER" && <span className="italic">Self-registered</span>}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-6 text-black/40">No public accounts yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
