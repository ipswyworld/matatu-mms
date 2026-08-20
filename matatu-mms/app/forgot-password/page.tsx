"use client";

import { useFormState, useFormStatus } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Send, Loader2 } from "lucide-react";
import { forgotPasswordAction } from "@/lib/actions";
import PublicFooter from "@/components/PublicFooter";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2" disabled={pending}>
      {pending ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} strokeWidth={2} />}
      {pending ? "Sending..." : "Send reset link"}
    </button>
  );
}

export default function ForgotPasswordPage() {
  const [state, formAction] = useFormState(forgotPasswordAction, undefined);

  return (
    <main className="min-h-screen bg-county-cream flex flex-col">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="mx-auto object-contain drop-shadow" priority />
            <h1 className="text-2xl font-black tracking-tight text-county-ink">Reset your password</h1>
            <p className="text-sm text-county-ink/55">
              Enter the email on your account and we'll send a reset link.
            </p>
          </div>

          <div className="card p-6 space-y-4 auth-card-enter">
            {state?.message ? (
              <div className="text-sm text-county-green bg-county-green/10 border border-county-green/30 rounded-lg px-3 py-2.5 font-semibold text-center">
                {state.message}
              </div>
            ) : (
              <form action={formAction} className="space-y-4">
                <div>
                  <label className="label" htmlFor="email">Email</label>
                  <input className="input" id="email" name="email" type="email" placeholder="you@nairobi.go.ke" required />
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
              <Link href="/login" className="text-xs font-extrabold text-county-green hover:underline inline-flex items-center gap-1">
                <ArrowLeft size={12} strokeWidth={2.5} />
                Back to Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
      <PublicFooter />
    </main>
  );
}
