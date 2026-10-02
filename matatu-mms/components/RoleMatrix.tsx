import { Check } from "lucide-react";
import { MATRIX, ROLE_LABELS, type Action } from "@/lib/rbac";
import { Role } from "@/lib/types";

const ALL_ROLES = Object.keys(MATRIX) as Role[];

// Every distinct permission across every role, sorted so related actions
// (same prefix — view_*, manage_*, decide_*...) land near each other.
const ALL_ACTIONS: Action[] = Array.from(new Set(ALL_ROLES.flatMap((r) => MATRIX[r]))).sort();

// Read-only — generated straight from lib/rbac.ts's MATRIX (the same
// source of truth the app enforces against), not a hand-maintained second
// copy. Answers "what can a Director of Mobility actually do" without
// reading source or opening the ops console's ABAC inspector
// (matatu-mms-ops, ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md §4.3
// Option B). See §3.3.
export default function RoleMatrix() {
  return (
    <div className="card p-5 space-y-3">
      <div>
        <h3 className="font-bold text-sm text-county-black">Role Matrix</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Every permission, by role — read-only, generated from the same permission source the backend enforces.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs text-left border-collapse">
          <thead>
            <tr>
              <th className="p-2 sticky left-0 bg-white text-black/60 uppercase text-[10px] font-bold">Permission</th>
              {ALL_ROLES.map((r) => (
                <th key={r} className="p-2 text-[10px] font-bold text-black/60 uppercase whitespace-nowrap [writing-mode:vertical-rl] rotate-180 align-bottom">
                  {ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {ALL_ACTIONS.map((action) => (
              <tr key={action} className="hover:bg-black/[0.02]">
                <td className="p-2 sticky left-0 bg-white font-mono text-[11px] text-county-black whitespace-nowrap">
                  {action.replace(/_/g, " ")}
                </td>
                {ALL_ROLES.map((r) => (
                  <td key={r} className="p-2 text-center">
                    {MATRIX[r].includes(action) && (
                      <Check size={13} strokeWidth={3} className="text-county-green inline" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
