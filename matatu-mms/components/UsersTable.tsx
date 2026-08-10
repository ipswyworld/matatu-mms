"use client";

import { useMemo, useState } from "react";
import { ROLE_LABELS } from "@/lib/rbac";
import { Role, Sacco, User } from "@/lib/types";

export default function UsersTable({ users, saccos }: { users: User[]; saccos: Sacco[] }) {
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
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="input flex-1 min-w-[200px]"
        />
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
              <th>Sacco</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td className="font-semibold">{u.name}</td>
                <td className="text-black/60">{u.email}</td>
                <td><span className="badge bg-county-green/10 text-county-green">{ROLE_LABELS[u.role as Role] || u.role}</span></td>
                <td>{saccoMap.get(u.saccoId || "") || "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-black/40 py-8">No users match your search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
