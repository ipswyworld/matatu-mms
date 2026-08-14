"use client";

import { useState } from "react";
import { updateUserAction } from "@/lib/actions";
import { ROLE_LABELS, ADMIN_TIER_ROLES, can } from "@/lib/rbac";
import { Role, Sacco, User } from "@/lib/types";

export default function EditUserModal({ user, saccos, viewerRole }: { user: User; saccos: Sacco[]; viewerRole: Role }) {
  const canAssignAdminTier = can(viewerRole, "manage_admins");
  const assignableRoles = Object.entries(ROLE_LABELS).filter(([r]) => canAssignAdminTier || !ADMIN_TIER_ROLES.includes(r as Role));
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<Role>(user.role);
  const [saccoId, setSaccoId] = useState(user.saccoId || "");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSuccess(newPassword ? "Saved — password updated." : "Saved.");
    setNewPassword("");
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="text-xs font-bold text-county-green hover:underline"
      >
        Edit
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl relative">
            <div className="flex justify-between items-center border-b pb-3">
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

            <div className="space-y-3.5">
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

              <div className="pt-2 border-t border-black/5">
                <label className="label">Reset Password (leave blank to keep current)</label>
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  type="password"
                  placeholder="New password"
                  minLength={6}
                  className="input"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary flex-1">
                Close
              </button>
              <button type="button" onClick={handleSave} disabled={pending} className="btn-primary flex-1">
                {pending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
