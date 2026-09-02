"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { StaffUser } from "@/lib/types";
import { lockUserAction, resetMfaAction, revokeSessionsAction, unlockUserAction } from "@/lib/actions";
import ActionButton from "./ActionButton";

/**
 * Account containment controls (Ops Console Rebuild Spec §21.3).
 *
 * With 1,000 staff accounts, lockouts and suspected compromises are routine
 * operational events rather than exceptions. These wrap
 * app/session_revocation.py, which already existed but had no surface
 * exposing it.
 */
export default function SessionControlPanel({ users }: { users: StaffUser[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q) || u.id.toLowerCase().includes(q),
    );
  }, [users, query]);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-county-black">Account Controls</h3>
          <p className="text-xs text-black/50 mt-0.5">
            Locking an account revokes its live sessions at the same time, so an already-issued token cannot outlive
            the lock. Resetting MFA does the same, in case a lost device still holds a session.
          </p>
        </div>
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-black/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, role, or id"
            className="input !py-1.5 !pl-8 text-xs w-64"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider text-black/40">
              <th className="pb-2 pr-3">Name</th>
              <th className="pb-2 pr-3">Role</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {filtered.map((user) => (
              <tr key={user.id}>
                <td className="py-2 pr-3">
                  <div className="text-xs font-semibold text-county-ink">{user.name}</div>
                  <div className="font-mono text-[10px] text-black/35">{user.id}</div>
                </td>
                <td className="py-2 pr-3">
                  <span className="badge bg-black/5 text-black/60 text-[9px] font-bold">{user.role}</span>
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`badge text-[9px] font-extrabold ${
                      user.isActive ? "bg-county-green/10 text-county-green" : "bg-county-red/10 text-county-red"
                    }`}
                  >
                    {user.isActive ? "ACTIVE" : "LOCKED"}
                  </span>
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-1.5 justify-end flex-wrap">
                    <ActionButton
                      actionId="session.revoke"
                      target={`${user.name} (${user.id})`}
                      onConfirm={(reason) => revokeSessionsAction(user.id, reason)}
                    >
                      Revoke sessions
                    </ActionButton>
                    <ActionButton
                      actionId="user.resetMfa"
                      target={`${user.name} (${user.id})`}
                      onConfirm={(reason) => resetMfaAction(user.id, reason)}
                    >
                      Reset MFA
                    </ActionButton>
                    {user.isActive ? (
                      <ActionButton
                        actionId="user.lock"
                        target={`${user.name} (${user.id})`}
                        onConfirm={(reason) => lockUserAction(user.id, reason)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-county-red/30 text-county-red hover:bg-county-red/5 transition-colors"
                      >
                        Lock
                      </ActionButton>
                    ) : (
                      <ActionButton
                        actionId="user.unlock"
                        target={`${user.name} (${user.id})`}
                        onConfirm={(reason) => unlockUserAction(user.id, reason)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-county-green/30 text-county-green hover:bg-county-green/5 transition-colors"
                      >
                        Unlock
                      </ActionButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-xs text-black/40 italic py-3">No accounts match that filter.</p>}
      </div>
    </div>
  );
}
