"use client";

import { useState, useTransition } from "react";
import { UserCog } from "lucide-react";
import { StaffUser } from "@/lib/types";
import { startImpersonationAction } from "@/lib/actions";

const ADMIN_TIER_ROLES = ["ADMIN", "SUPERADMIN"];

function ImpersonateButton({ user }: { user: StaffUser }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await startImpersonationAction(user.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      // A real browser navigation, not next/navigation's redirect() — see
      // the comment on startImpersonationAction for why.
      if (result.url) window.location.href = result.url;
    });
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="flex items-center gap-1 text-[11px] font-bold text-county-green hover:underline">
        <UserCog size={12} strokeWidth={2.5} />
        Impersonate
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={handleConfirm} disabled={isPending} className="text-[10px] font-bold text-white bg-county-green rounded px-2 py-1 disabled:opacity-50">
        {isPending ? "Starting…" : "Confirm"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-[10px] font-bold text-black/50 rounded px-2 py-1 hover:bg-black/5">
        Cancel
      </button>
      {error && <span className="text-[10px] font-bold text-county-red">{error}</span>}
    </div>
  );
}

export default function ImpersonationPanel({ staff }: { staff: StaffUser[] }) {
  const impersonatable = staff.filter((u) => !ADMIN_TIER_ROLES.includes(u.role) && u.isActive);

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Impersonation</h3>
        <p className="text-xs text-black/50 mt-0.5">
          View the staff app as a specific account for support — every start and end is written to the Audit Trail
          below, and a persistent banner marks the session as impersonated the whole time. Admin/Super Admin accounts
          can&apos;t be impersonated.
        </p>
      </div>

      {impersonatable.length === 0 ? (
        <p className="text-xs text-black/40 italic">No eligible accounts.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto space-y-1.5">
          {impersonatable.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-black/10 bg-black/[0.01]">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-county-black">{u.name}</span>
                <span className="ml-2 badge text-[9px] font-bold bg-black/5 text-black/50">{u.role}</span>
              </div>
              <ImpersonateButton user={u} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
