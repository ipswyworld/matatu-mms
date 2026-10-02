"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addUserAction } from "@/lib/actions";
import { can, ADMIN_TIER_ROLES, ROLE_LABELS, ROLE_CAPABILITY_SUMMARY, STAFF_ROLE_TIERS } from "@/lib/rbac";
import { Role } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Adding..." : "Add user"}
    </button>
  );
}

// Operators/Crew/Passengers are deliberately not offered here — they're
// public accounts with their own real lifecycle (onboarding wizard +
// county approval, issued by their own operator, or self-registration),
// not something this staff-roster shortcut should create. See STAFF_ROLES.
export default function NewUserForm({ viewerRole }: { viewerRole: Role }) {
  const [state, formAction] = useFormState(addUserAction, undefined);
  const canAssignAdminTier = can(viewerRole, "manage_admins");
  const defaultRole = STAFF_ROLE_TIERS.find((t) => t.label === "Oversight")!.roles[0];
  const [role, setRole] = useState<Role>(defaultRole);

  return (
    <div className="card p-5 h-fit">
      <h3 className="font-bold text-sm mb-4">Add a county staff user</h3>
      <form action={formAction} className="space-y-3">
        <div>
          <label className="label" htmlFor="name">Full name</label>
          <input className="input" id="name" name="name" required />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Temporary password</label>
          <input className="input" id="password" name="password" type="text" required />
        </div>
        <div>
          <label className="label" htmlFor="role">Role</label>
          <select
            className="input"
            id="role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {STAFF_ROLE_TIERS.map((tier) => {
              const isAdminTierGroup = tier.roles.every((r) => ADMIN_TIER_ROLES.includes(r));
              if (isAdminTierGroup && !canAssignAdminTier) return null;
              return (
                <optgroup key={tier.label} label={tier.label}>
                  {tier.roles.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {ROLE_CAPABILITY_SUMMARY[role] && (
            <p className="text-[11px] text-county-ink/50 mt-1">{ROLE_CAPABILITY_SUMMARY[role]}</p>
          )}
        </div>

        {state?.error && (
          <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2">
            {state.error}
          </div>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
