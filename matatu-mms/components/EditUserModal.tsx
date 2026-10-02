"use client";

import { useState } from "react";
import { updateUserAction, getUserActivityAction } from "@/lib/actions";
import { ROLE_LABELS, ADMIN_TIER_ROLES, STAFF_ROLES, can, MATRIX, ALL_BACKEND_PERMISSIONS } from "@/lib/rbac";
import { Role, Sacco, User, UserActivity } from "@/lib/types";
import PasswordInput from "./PasswordInput";

const LOGIN_EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Signed in",
  LOGIN_FAILED: "Failed sign-in",
  LOGOUT: "Signed out",
  REGISTER: "Account created",
};

const LOGIN_EVENT_STYLES: Record<string, string> = {
  LOGIN_SUCCESS: "bg-county-green/10 text-county-green",
  LOGIN_FAILED: "bg-county-red/10 text-county-red",
  LOGOUT: "bg-black/5 text-black/60",
  REGISTER: "bg-blue-500/10 text-blue-700",
};

function parseExtraPermissions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function EditUserModal({ user, saccos, viewerRole }: { user: User; saccos: Sacco[]; viewerRole: Role }) {
  const canAssignAdminTier = can(viewerRole, "manage_admins");
  const assignableRoles = Object.entries(ROLE_LABELS).filter(([r]) => canAssignAdminTier || !ADMIN_TIER_ROLES.includes(r as Role));
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<Role>(user.role);
  const [saccoId, setSaccoId] = useState(user.saccoId || "");
  const [newPassword, setNewPassword] = useState("");
  const [extraPermissions, setExtraPermissions] = useState<string[]>(() => parseExtraPermissions(user.extraPermissions));
  const [additionalRoles, setAdditionalRoles] = useState<string[]>(() => parseExtraPermissions(user.additionalRoles));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "activity">("details");
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Only permissions the selected role doesn't already grant are worth
  // offering here — checking one the role already has would be a no-op.
  const rolePermissions = new Set<string>(MATRIX[role] ?? []);
  const grantablePermissions = ALL_BACKEND_PERMISSIONS.filter((p) => !rolePermissions.has(p));

  // Additional predefined roles this account can hold on top of the
  // primary role above — not custom role creation, just combining roles
  // that already exist in STAFF_ROLES. The currently-selected primary role
  // is excluded (granting it again as "additional" would be a no-op).
  const grantableRoles = STAFF_ROLES.filter((r) => r !== role);

  function togglePermission(action: string) {
    setExtraPermissions((prev) => (prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]));
  }

  function toggleAdditionalRole(r: string) {
    setAdditionalRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  // Fetched on demand (not on modal open) — most Edit clicks are for the
  // Details tab, so there's no reason to pay for this query every time.
  async function openActivityTab() {
    setTab("activity");
    if (activity || activityLoading) return;
    setActivityLoading(true);
    setActivityError(null);
    const result = await getUserActivityAction(user.id);
    setActivityLoading(false);
    if ("error" in result) {
      setActivityError(result.error);
    } else {
      setActivity(result);
    }
  }

  async function handleSave() {
    setPending(true);
    setError(null);
    setSuccess(null);
    const result = await updateUserAction(user.id, {
      name,
      email,
      role,
      saccoId: role === "SACCO_OPERATOR" ? saccoId || undefined : null,
      newPassword: newPassword.trim() || undefined,
      // Only Super Admins can grant these (enforced server-side too) — an
      // Admin never sends this field at all, rather than sending an empty
      // array that would silently wipe a Super-Admin-granted list.
      ...(canAssignAdminTier ? { extraPermissions, additionalRoles } : {}),
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.pendingRoleGrantId) {
      setSuccess("Saved. The role change to " + role + " needs a second Super Admin's approval before it takes effect — see the ops console's Sessions page.");
    } else {
      setSuccess(newPassword ? "Saved — password updated." : "Saved.");
    }
    setNewPassword("");
  }

  return (
    <>
      {/* px-2 py-1.5 -mx-2 -my-1.5 expands the actual clickable area well
          past the 12px "Edit" glyphs themselves (previously a bare
          zero-padding text link — an easy miss in a dense table,
          especially on lower rows or with a trackpad) without changing
          how it looks inline with the rest of the row. */}
      <button
        onClick={() => { setTab("details"); setIsOpen(true); }}
        className="text-xs font-bold text-county-green hover:underline px-2 py-1.5 -mx-2 -my-1.5"
      >
        Edit
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          {/* Plain flex-column, not sticky-positioned children — a prior
              version pinned the header/footer via `sticky` + negative
              margins to cancel the parent's padding, which on this
              combination of Tailwind classes could render as a full-width
              white layer sitting ON TOP of the fields below it (Full
              Name/Email/Role all became unclickable, even though nothing
              looked wrong visually). shrink-0 header/footer + a flex-1
              scrollable middle achieves the same "buttons stay reachable
              while the long permissions list scrolls" result without any
              stacking-context risk. */}
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl relative my-8 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b p-6 pb-3 shrink-0">
              <div>
                <h3 className="font-extrabold text-base text-county-black">Edit User</h3>
                <p className="text-xs text-black/50">Update account details, role, or reset the password directly.</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-black/40 hover:text-black font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-1 px-6 pt-3 border-b border-black/5 shrink-0">
              <button
                type="button"
                onClick={() => setTab("details")}
                className={`text-xs font-bold px-3 py-2 -mb-px border-b-2 ${
                  tab === "details" ? "border-county-green text-county-green" : "border-transparent text-black/40 hover:text-black/70"
                }`}
              >
                Details
              </button>
              <button
                type="button"
                onClick={openActivityTab}
                className={`text-xs font-bold px-3 py-2 -mb-px border-b-2 ${
                  tab === "activity" ? "border-county-green text-county-green" : "border-transparent text-black/40 hover:text-black/70"
                }`}
              >
                Activity
              </button>
            </div>

            {tab === "details" ? (
            <div className="px-6 space-y-3.5 overflow-y-auto flex-1 py-3">
              {error && (
                <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-county-green/10 border border-county-green/30 text-county-green text-xs p-3 rounded-lg font-semibold">
                  {success}
                </div>
              )}

              <div>
                <label className="label">Full Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="input" />
              </div>
              <div>
                <label className="label">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="input font-semibold">
                  {assignableRoles.map(([r, label]) => (
                    <option key={r} value={r}>{label}</option>
                  ))}
                </select>
              </div>
              {role === "SACCO_OPERATOR" && (
                <div>
                  <label className="label">Operator</label>
                  <select value={saccoId} onChange={(e) => setSaccoId(e.target.value)} className="input font-semibold">
                    <option value="">Select an operator</option>
                    {saccos.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {canAssignAdminTier && (
                <div className="pt-2 border-t border-black/5">
                  <label className="label">Extra Permissions (beyond the role above)</label>
                  <p className="text-[11px] text-black/50 -mt-1 mb-2">
                    Grant this specific account one or more capabilities without changing their role — e.g. Crew
                    management for a Viewer. Super Admin only.
                  </p>
                  {grantablePermissions.length === 0 ? (
                    <p className="text-xs text-black/40 italic">This role already includes every permission.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto border border-black/10 rounded-lg p-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {grantablePermissions.map((action) => (
                        <label key={action} className="flex items-center gap-1.5 text-xs font-semibold text-county-black cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={extraPermissions.includes(action)}
                            onChange={() => togglePermission(action)}
                            className="h-3.5 w-3.5 rounded border-black/20 text-county-green focus:ring-county-green/40"
                          />
                          {action}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {canAssignAdminTier && (
                <div className="pt-2 border-t border-black/5">
                  <label className="label">Additional Roles (beyond the role above)</label>
                  <p className="text-[11px] text-black/50 -mt-1 mb-2">
                    Give this account another predefined role's whole permission bundle without changing their
                    primary role — e.g. a Senior Enforcement Officer who should also see the Admin dashboard.
                    Super Admin only.
                  </p>
                  {grantableRoles.length === 0 ? (
                    <p className="text-xs text-black/40 italic">No other roles to grant.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto border border-black/10 rounded-lg p-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {grantableRoles.map((r) => (
                        <label key={r} className="flex items-center gap-1.5 text-xs font-semibold text-county-black cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={additionalRoles.includes(r)}
                            onChange={() => toggleAdditionalRole(r)}
                            className="h-3.5 w-3.5 rounded border-black/20 text-county-green focus:ring-county-green/40"
                          />
                          {ROLE_LABELS[r]}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-black/5">
                <label className="label">Reset Password (leave blank to keep current)</label>
                <PasswordInput
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password"
                  minLength={6}
                />
              </div>
            </div>
            ) : (
            <div className="px-6 space-y-4 overflow-y-auto flex-1 py-3">
              {activityLoading && <p className="text-xs text-black/40 text-center py-6">Loading activity…</p>}
              {activityError && (
                <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                  {activityError}
                </div>
              )}
              {activity && (
                <>
                  <div>
                    <label className="label">Login History</label>
                    {activity.loginEvents.length === 0 ? (
                      <p className="text-xs text-black/40 italic mt-1">No login activity recorded yet.</p>
                    ) : (
                      <div className="mt-1.5 space-y-1.5 max-h-56 overflow-y-auto">
                        {activity.loginEvents.map((ev) => (
                          <div key={ev.id} className="flex items-start justify-between gap-2 border border-black/5 rounded-lg px-2.5 py-2">
                            <div className="min-w-0">
                              <span className={`badge text-[10px] font-bold ${LOGIN_EVENT_STYLES[ev.eventType] || "bg-black/5 text-black/60"}`}>
                                {LOGIN_EVENT_LABELS[ev.eventType] || ev.eventType}
                              </span>
                              {ev.reason && <span className="block text-[10px] text-black/40 mt-0.5">{ev.reason.replace(/_/g, " ")}</span>}
                              {ev.ipAddress && <span className="block text-[10px] text-black/30 mt-0.5 font-mono">{ev.ipAddress}</span>}
                            </div>
                            <span className="text-[10px] text-black/40 shrink-0 whitespace-nowrap">{new Date(ev.createdAt).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-black/5">
                    <label className="label">Audit Trail (actions this account performed)</label>
                    {activity.auditLogs.length === 0 ? (
                      <p className="text-xs text-black/40 italic mt-1">No recorded actions yet.</p>
                    ) : (
                      <div className="mt-1.5 space-y-1.5 max-h-56 overflow-y-auto">
                        {activity.auditLogs.map((log) => (
                          <div key={log.id} className="flex items-start justify-between gap-2 border border-black/5 rounded-lg px-2.5 py-2">
                            <div className="min-w-0">
                              <span className="badge text-[10px] font-bold bg-black/5 text-black/60">{log.action}</span>
                              <span className="block text-[10px] text-black/40 mt-0.5 font-mono truncate">{log.resourceType}/{log.resourceId}</span>
                            </div>
                            <span className="text-[10px] text-black/40 shrink-0 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            )}

            <div className="p-6 pt-2 flex gap-3 border-t border-black/5 shrink-0">
              <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary flex-1">
                Close
              </button>
              {tab === "details" && (
                <button type="button" onClick={handleSave} disabled={pending} className="btn-primary flex-1">
                  {pending ? "Saving..." : "Save Changes"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
