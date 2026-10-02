"use client";

import { useFormState, useFormStatus } from "react-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import { verifyMfaAction } from "@/lib/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2" disabled={pending}>
      {pending ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} strokeWidth={2} />}
      {pending ? "Verifying..." : "Verify and continue"}
    </button>
  );
}

// Second step of login for any account with MFA enabled — reached only via
// loginAction's redirect after a correct password. Reads no session of its
// own; verifyMfaAction pulls the pending token from its own short-lived
// cookie (see lib/session.ts).
export default function MfaVerifyForm() {
  const [state, formAction] = useFormState(verifyMfaAction, undefined);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl font-black tracking-tight text-county-ink">Two-factor verification</h2>
        <p className="text-sm text-county-ink/55 mt-2">
          Enter the 6-digit code from your authenticator app, or one of your backup codes.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="code">Authentication code</label>
          <input
            className="input tracking-[0.3em] text-center text-lg font-bold"
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={17}
            autoFocus
            required
          />
        </div>

        {state?.error && (
          <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
            {state.error}
          </div>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
