"use client";

import { useFormState, useFormStatus } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Send, KeyRound, Loader2 } from "lucide-react";
import { requestPhoneOtpAction, resetPasswordWithOtpAction } from "@/lib/actions";
import AuthSkyline from "@/components/AuthSkyline";
import PublicFooter from "@/components/PublicFooter";
import PasswordInput from "@/components/PasswordInput";

function SendCodeButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2" disabled={pending}>
      {pending ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} strokeWidth={2} />}
      {pending ? "Sending..." : "Send reset code"}
    </button>
  );
}

function ResetButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2" disabled={pending}>
      {pending ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={16} strokeWidth={2} />}
      {pending ? "Updating..." : "Set new password"}
    </button>
  );
}

// Phone-based, two-step: request a code by SMS, then submit that code plus
// a new password. Two separate server actions (see lib/actions.ts) rather
// than one, since the UI needs to know when to swap forms.
export default function ForgotPasswordPage() {
  const [requestState, requestAction] = useFormState(requestPhoneOtpAction, undefined);
  const [resetState, resetAction] = useFormState(resetPasswordWithOtpAction, undefined);

  const showOtpStep = requestState?.step === "otp" && !resetState?.message;

  return (
    <main className="relative min-h-screen bg-county-cream flex flex-col overflow-hidden">
      <AuthSkyline heightClassName="h-[70vh]" />
      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="mx-auto object-contain drop-shadow" priority />
            <h1 className="text-2xl font-black tracking-tight text-county-ink">Reset your password</h1>
            <p className="text-sm text-county-ink/55">
              {showOtpStep
                ? `Enter the code we sent to ${requestState?.phone}.`
                : "Enter the phone number on your account and we'll text you a reset code."}
            </p>
          </div>

          <div className="card p-6 space-y-4 auth-card-enter">
            {resetState?.message ? (
              <div className="text-sm text-county-green bg-county-green/10 border border-county-green/30 rounded-lg px-3 py-2.5 font-semibold text-center">
                {resetState.message}
              </div>
            ) : showOtpStep ? (
              <form action={resetAction} className="space-y-4">
                <input type="hidden" name="phone" value={requestState?.phone} />
                <div>
                  <label className="label" htmlFor="otp">Reset Code</label>
                  <input className="input" id="otp" name="otp" type="text" inputMode="numeric" placeholder="123456" required maxLength={6} />
                </div>
                <div>
                  <label className="label" htmlFor="newPassword">New Password</label>
                  <PasswordInput id="newPassword" name="newPassword" placeholder="••••••••" required minLength={6} />
                </div>
                <div>
                  <label className="label" htmlFor="confirmPassword">Confirm Password</label>
                  <PasswordInput id="confirmPassword" name="confirmPassword" placeholder="••••••••" required minLength={6} />
                </div>
                {resetState?.error && (
                  <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
                    {resetState.error}
                  </div>
                )}
                <ResetButton />
              </form>
            ) : (
              <form action={requestAction} className="space-y-4">
                <div>
                  <label className="label" htmlFor="phone">Phone Number</label>
                  <input className="input" id="phone" name="phone" type="tel" placeholder="+254 7XX XXX XXX" required />
                </div>
                {requestState?.error && (
                  <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
                    {requestState.error}
                  </div>
                )}
                <SendCodeButton />
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
      <PublicFooter transparent />
    </main>
  );
}
