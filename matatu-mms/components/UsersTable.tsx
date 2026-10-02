"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, Shield, Ban, RotateCcw, LogOut } from "lucide-react";
import { ROLE_LABELS, ADMIN_TIER_ROLES, can } from "@/lib/rbac";
import { Role, Sacco, User } from "@/lib/types";
import { setUserActiveAction, revokeUserSessionsAction } from "@/lib/actions";
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTransition] = useTransition();
  const [bulkError, setBulkError] = useState<string | null>(null);

  const saccoMap = useMemo(() => new Map(saccos.map((s) => [s.id, s.name])), [saccos]);

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesRole = !roleFilter || u.role === roleFilter;
    return matchesQuery && matchesRole;
  });

  // Same eligibility as the per-row action menu: a viewer without
  // manage_admins can't act on admin-tier accounts, and nobody acts on
  // their own account from this table.
  const selectable = filtered.filter((u) => u.id !== viewerUserId && (!ADMIN_TIER_ROLES.includes(u.role) || canManageAdmins));
  const allSelectableSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id));

  function toggleAll() {
    if (allSelectableSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map((u) => u.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Loops the existing per-user actions rather than a synthetic bulk
  // endpoint — one AuditLog entry per user, exactly as if each had been
  // clicked individually, not a single batch entry hiding who was
  // actually affected.
  function runBulk(fn: (userId: string) => Promise<{ error?: string }>) {
    const ids = Array.from(selected);
    startBulkTransition(async () => {
      setBulkError(null);
      const failures: string[] = [];
      for (const id of ids) {
        const result = await fn(id);
        if (result.error) failures.push(id);
      }
      setSelected(new Set());
      if (failures.length > 0) {
        setBulkError(`${failures.length} of ${ids.length} action(s) failed.`);
      }
    });
  }

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

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-county-green/[0.04] border-b border-county-ink/[0.06]">
          <span className="text-xs font-bold text-county-black">{selected.size} selected</span>
          <button
            disabled={bulkPending}
            onClick={() => runBulk((id) => setUserActiveAction(id, false))}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-county-red/30 text-county-red hover:bg-county-red/5 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <Ban size={12} /> Deactivate
          </button>
          <button
            disabled={bulkPending}
            onClick={() => runBulk((id) => setUserActiveAction(id, true))}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-county-green/30 text-county-green hover:bg-county-green/5 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <RotateCcw size={12} /> Reactivate
          </button>
          <button
            disabled={bulkPending}
            onClick={() => runBulk((id) => revokeUserSessionsAction(id))}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-yellow-700/30 text-yellow-700 hover:bg-yellow-700/5 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <LogOut size={12} /> Revoke sessions
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[11px] font-bold text-black/40 hover:text-black/60 ml-1">
            Clear
          </button>
          {bulkError && <span className="text-[11px] text-county-red font-semibold">{bulkError}</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="w-8">
                <input type="checkbox" checked={allSelectableSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Operator</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const eligible = u.id !== viewerUserId && (!ADMIN_TIER_ROLES.includes(u.role) || canManageAdmins);
              return (
              <tr key={u.id}>
                <td>
                  {eligible && (
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)} aria-label={`Select ${u.name}`} />
                  )}
                </td>
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
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-black/40 py-8">No users match your search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
