"use client";

import { useMemo, useState } from "react";
import { Search, Shield } from "lucide-react";
import { ROLE_LABELS, ADMIN_TIER_ROLES, can } from "@/lib/rbac";
import { Role, Sacco, User } from "@/lib/types";
import EditUserModal from "./EditUserModal";
import AccountActionsMenu from "./AccountActionsMenu";

export default function UsersTable({
  users,
  saccos,
  viewerRole,
  viewerUserId,
}: {
  users: User[];
  saccos: Sacco[];
  viewerRole: Role;
  viewerUserId: string;
}) {
  const canManageAdmins = can(viewerRole, "manage_admins");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");

  const saccoMap = useMemo(() => new Map(saccos.map((s) => [s.id, s.name])), [saccos]);

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesRole = !roleFilter || u.role === roleFilter;
    return matchesQuery && matchesRole;
  });

  return (
    <div className="card overflow-hidden h-fit">
      <div className="flex flex-wrap gap-3 items-center p-4 border-b border-county-ink/[0.06]">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-black/30 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="input w-full !pl-8"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="input w-56">
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <option key={role} value={role}>{label}</option>
          ))}
        </select>
        <span className="text-xs font-bold text-county-ink/50 ml-auto whitespace-nowrap">
          {filtered.length} of {users.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Operator</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td className="font-semibold">{u.name}</td>
                <td className="text-black/60">{u.email}</td>
                <td>
                  <span className="badge bg-county-green/10 text-county-green inline-flex items-center gap-1">
                    <Shield size={11} strokeWidth={2.5} />
                    {ROLE_LABELS[u.role as Role] || u.role}
                  </span>
                </td>
                <td>{saccoMap.get(u.saccoId || "") || "—"}</td>
                <td>
                  {ADMIN_TIER_ROLES.includes(u.role) && !canManageAdmins ? (
                    <span className="text-[11px] text-black/30 italic">Super Admin only</span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <EditUserModal user={u} saccos={saccos} viewerRole={viewerRole} />
                      {u.id !== viewerUserId && (
                        <AccountActionsMenu userId={u.id} targetRole={u.role} isActive={u.isActive !== false} viewerRole={viewerRole} />
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-black/40 py-8">No users match your search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
