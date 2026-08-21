"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MoreHorizontal, Ban, RotateCcw, LogOut } from "lucide-react";
import { setUserActiveAction, revokeUserSessionsAction } from "@/lib/actions";
import { ADMIN_TIER_ROLES, can } from "@/lib/rbac";
import { Role } from "@/lib/types";

// Deactivate, revoke-sessions, and (elsewhere) reset-password are three
// different severities that used to be separate same-weight buttons — this
// groups them under one menu with plain-language consequence text so it's
// obvious which one to reach for. See ADMIN_DASHBOARD_AUDIT §3.5.
export default function AccountActionsMenu({
  userId,
  targetRole,
  isActive,
  viewerRole,
}: {
  userId: string;
  targetRole: Role;
  isActive: boolean;
  viewerRole: Role;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"deactivate" | "revoke" | null>(null);
  const [active, setActive] = useState(isActive);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  // Mirrors backend/app/routes/users.py's revoke_user_sessions: only a
  // Super Admin may revoke another Admin-tier account's sessions.
  const canRevokeSessions = !ADMIN_TIER_ROLES.includes(targetRole) || can(viewerRole, "manage_admins");

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirm(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleToggleActive = () => {
    setError(null);
    startTransition(async () => {
      const result = await setUserActiveAction(userId, !active);
      if (result.error) { setError(result.error); return; }
      setActive(!active);
      setConfirm(null);
      setOpen(false);
    });
  };

  const handleRevoke = () => {
    setError(null);
    startTransition(async () => {
      const result = await revokeUserSessionsAction(userId);
      if (result.error) { setError(result.error); return; }
      setConfirm(null);
      setOpen(false);
    });
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => { setOpen((v) => !v); setConfirm(null); }}
        className="p-1 rounded hover:bg-black/5 text-black/40 hover:text-black/70"
        aria-label="Account actions"
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 bg-white rounded-lg shadow-xl border border-black/10 p-1.5 text-left">
          {error && (
            <div className="text-[11px] text-county-red font-semibold px-2 py-1.5">{error}</div>
          )}

          {confirm === null && (
            <>
              <button
                onClick={() => setConfirm("deactivate")}
                className="w-full text-left px-2.5 py-2 rounded hover:bg-black/[0.03] flex items-start gap-2"
              >
                {active ? <Ban size={14} strokeWidth={2} className="text-county-red mt-0.5 shrink-0" /> : <RotateCcw size={14} strokeWidth={2} className="text-county-green mt-0.5 shrink-0" />}
                <span>
                  <span className="block text-xs font-bold text-county-black">{active ? "Deactivate account" : "Reactivate account"}</span>
                  <span className="block text-[10px] text-black/50">
                    {active ? "Blocks new logins immediately. Keeps their history intact." : "Allows this account to log in again."}
                  </span>
                </span>
              </button>

              {canRevokeSessions ? (
                <button
                  onClick={() => setConfirm("revoke")}
                  className="w-full text-left px-2.5 py-2 rounded hover:bg-black/[0.03] flex items-start gap-2"
                >
                  <LogOut size={14} strokeWidth={2} className="text-yellow-700 mt-0.5 shrink-0" />
                  <span>
                    <span className="block text-xs font-bold text-county-black">Revoke sessions</span>
                    <span className="block text-[10px] text-black/50">
                      Logs them out everywhere right now. They can still log back in — this isn't the same as deactivating.
                    </span>
                  </span>
                </button>
              ) : (
                <div className="px-2.5 py-2 text-[10px] text-black/30 italic">Only a Super Admin can revoke another Admin's sessions.</div>
              )}
            </>
          )}

          {confirm === "deactivate" && (
            <div className="p-2 space-y-2">
              <p className="text-xs text-county-black font-semibold">
                {active ? "Deactivate this account? They'll be blocked from logging in immediately." : "Reactivate this account?"}
              </p>
              <div className="flex gap-1.5">
                <button disabled={isPending} onClick={handleToggleActive} className="flex-1 text-[11px] font-bold text-white bg-county-red rounded px-2 py-1.5 disabled:opacity-40">
                  {isPending ? "..." : "Confirm"}
                </button>
                <button onClick={() => setConfirm(null)} className="flex-1 text-[11px] font-bold text-black/50 rounded px-2 py-1.5 hover:bg-black/5">Cancel</button>
              </div>
            </div>
          )}

          {confirm === "revoke" && (
            <div className="p-2 space-y-2">
              <p className="text-xs text-county-black font-semibold">Revoke all active sessions for this account?</p>
              <div className="flex gap-1.5">
                <button disabled={isPending} onClick={handleRevoke} className="flex-1 text-[11px] font-bold text-white bg-yellow-700 rounded px-2 py-1.5 disabled:opacity-40">
                  {isPending ? "..." : "Confirm"}
                </button>
                <button onClick={() => setConfirm(null)} className="flex-1 text-[11px] font-bold text-black/50 rounded px-2 py-1.5 hover:bg-black/5">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
