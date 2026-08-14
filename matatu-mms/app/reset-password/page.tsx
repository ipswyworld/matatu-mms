"use client";

import { Suspense } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPasswordAction } from "@/lib/actions";
import NairobiCrest from "@/components/NairobiCrest";
import PublicFooter from "@/components/PublicFooter";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base" disabled={pending}>
      {pending ? "Updating..." : "Set new password"}
    </button>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [state, formAction] = useFormState(resetPasswordAction, undefined);

  return (
    <div className="card p-6 space-y-4">
      {!token ? (
        <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold text-center">
          This reset link is missing its token. Request a new one from the sign-in page.
        </div>
      ) : state?.message ? (
        <div className="text-sm text-county-green bg-county-green/10 border border-county-green/30 rounded-lg px-3 py-2.5 font-semibold text-center">
          {state.message}
        </div>
      ) : (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div>
            <label className="label" htmlFor="newPassword">New password</label>
            <input className="input" id="newPassword" name="newPassword" type="password" placeholder="••••••••" required minLength={6} />
          </div>
          <div>
            <label className="label" htmlFor="confirmPassword">Confirm password</label>
            <input className="input" id="confirmPassword" name="confirmPassword" type="password" placeholder="••••••••" required minLength={6} />
          </div>
          {state?.error && (
            <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
              {state.error}
            </div>
          )}
          <SubmitButton />
        </form>
      )}

      <div className="text-center pt-2 border-t border-black/5">
        <Link href="/login" className="text-xs font-extrabold text-county-green hover:underline">
          ← Back to Sign in
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen bg-county-cream flex flex-col">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <NairobiCrest size={48} className="mx-auto drop-shadow" />
            <h1 className="text-2xl font-black tracking-tight text-county-ink">Set a new password</h1>
          </div>

          <Suspense fallback={<div className="card p-6 text-center text-sm text-county-ink/50">Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
      <PublicFooter />
    </main>
  );
}
