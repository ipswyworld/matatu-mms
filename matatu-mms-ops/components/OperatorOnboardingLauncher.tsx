import { ClipboardCheck } from "lucide-react";

// A "golden path" launcher, per OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md A.3 —
// deliberately a LINK to the real /saccos/verify hub in the staff app, not
// a duplicate wizard embedded here. Two real constraints ruled out
// embedding: the actual self-service wizard (OperatorOnboardingWizard.tsx)
// is gated to a logged-in Sacco Operator's own session/saccoId, so a Super
// Admin can't drive it directly; and it lives in a third, separately
// deployed app (matatu-mms-public) with no shared component library this
// console could import it from. /saccos/verify already enforces the real
// two-stage approval + document-completeness rules — reusing the real
// workflow via a link is more honest than forking a parallel flat form.
const STAFF_APP_URL = process.env.STAFF_APP_URL || "http://localhost:3000";

export default function OperatorOnboardingLauncher() {
  return (
    <div className="card p-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 h-9 w-9 rounded-lg bg-county-green/10 text-county-green flex items-center justify-center">
          <ClipboardCheck size={18} strokeWidth={2} />
        </span>
        <div>
          <h3 className="font-bold text-sm text-county-black">Operator (Sacco) Onboarding</h3>
          <p className="text-xs text-black/50 mt-0.5 max-w-md">
            New-operator applications go through the same document-completeness gate and two-stage approval as
            everywhere else — this links to that real hub rather than a shortcut form.
          </p>
        </div>
      </div>
      <a
        href={`${STAFF_APP_URL}/saccos/verify`}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg px-4 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors shrink-0"
      >
        Open Verification Hub →
      </a>
    </div>
  );
}
