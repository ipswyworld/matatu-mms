"use client";

import { UserPlus } from "lucide-react";
import { PendingRoleGrant, StaffUser } from "@/lib/types";
import { approveRoleGrantAction, rejectRoleGrantAction } from "@/lib/actions";
import ActionButton from "@/components/ActionButton";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-county-green/10 text-county-green",
  REJECTED: "bg-county-red/10 text-county-red",
};

/**
 * Two-person sign-off queue for promotions into the Admin tier
 * (backend/app/routes/users.py's update_user defers these instead of
 * applying them immediately — the one genuinely new workflow in Phase 7).
 * The requester can never approve their own request; the backend enforces
 * that, this UI just doesn't offer the button for it.
 */
export default function RoleGrantsPanel({ grants, staff, viewerUserId }: { grants: PendingRoleGrant[]; staff: StaffUser[]; viewerUserId: string }) {
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name || id;
  const pending = grants.filter((g) => g.status === "PENDING");
  const decided = grants.filter((g) => g.status !== "PENDING").slice(0, 10);

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
          <UserPlus size={15} strokeWidth={2} className="text-county-ink/50" />
          Role Grant Requests
        </h3>
        <p className="text-xs text-black/50 mt-0.5">
          Promoting an account into ADMIN or SUPERADMIN needs a second Super Admin&apos;s approval.
        </p>
      </div>

      {pending.length === 0 ? (
        <p className="text-xs text-black/40 italic">No pending requests.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((g) => {
            const isSelfRequest = g.requestedBy === viewerUserId;
            return (
              <div key={g.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50/50 flex-wrap">
                <div className="min-w-0 text-xs">
                  <span className="font-semibold text-county-black">{nameOf(g.userId)}</span> → requested{" "}
                  <span className="badge text-[9px] font-extrabold bg-black/5 text-black/60">{g.requestedRole}</span>
                  <p className="text-[10px] text-black/40 mt-0.5">
                    Requested by {nameOf(g.requestedBy)} · {new Date(g.requestedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isSelfRequest ? (
                    <span className="text-[10px] text-black/40 italic">Waiting for a different Super Admin</span>
                  ) : (
                    <>
                      <ActionButton
                        actionId="roleGrant.approve"
                        target={`${nameOf(g.userId)} → ${g.requestedRole}`}
                        onConfirm={(reason, reauthToken) => approveRoleGrantAction(g.id, reason, reauthToken)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-county-green text-white hover:bg-county-green-dark transition-colors"
                      >
                        Approve
                      </ActionButton>
                      <ActionButton
                        actionId="roleGrant.reject"
                        target={`${nameOf(g.userId)} → ${g.requestedRole}`}
                        onConfirm={(reason) => rejectRoleGrantAction(g.id, reason)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 transition-colors"
                      >
                        Reject
                      </ActionButton>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {decided.length > 0 && (
        <div className="pt-2 border-t border-black/5 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-black/40">Recent decisions</p>
          {decided.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-3 text-[11px] py-1">
              <span className="text-black/60">{nameOf(g.userId)} → {g.requestedRole}</span>
              <span className={`badge text-[9px] font-extrabold ${STATUS_STYLE[g.status]}`}>{g.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
