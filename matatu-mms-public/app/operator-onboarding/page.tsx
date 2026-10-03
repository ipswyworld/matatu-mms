"use client";

import { useFormState } from "react-dom";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Building2, ArrowLeft } from "lucide-react";
import { operatorOnboardingRegisterAction } from "@/lib/actions";
import AuthSkyline from "@/components/AuthSkyline";
import PublicFooter from "@/components/PublicFooter";
import PasswordInput from "@/components/PasswordInput";

// Visual chrome matches the rest of the auth family (register, forgot-
// password, reset-password): county-cream body, real crest, shared
// card/input/label/btn-primary classes from globals.css — this page
// previously ran its own bespoke dark theme with a diagonal-stripe
// background and a giant watermark icon, inconsistent with every other
// auth-family page.
export default function OperatorOnboardingPage() {
  const [state, formAction] = useFormState(operatorOnboardingRegisterAction, undefined);
  const [saccoType, setSaccoType] = useState<"NEW" | "EXISTING">("EXISTING");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [fullName, setFullName] = useState("");
  const [signature, setSignature] = useState("");

  const signatureMatches =
    signature.trim().length > 0 && signature.trim().toLowerCase() === fullName.trim().toLowerCase();
  const canSubmit = agreedToTerms && signatureMatches;

  return (
    <main className="relative min-h-screen bg-county-cream flex flex-col overflow-hidden">
      <AuthSkyline heightClassName="h-[70vh]" />
      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center space-y-2">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="mx-auto object-contain drop-shadow" priority />
            <h1 className="text-2xl font-black tracking-tight text-county-ink">Operator Onboarding & Verification</h1>
            <p className="text-sm text-county-ink/55">
              Register your Operator here to begin county verification. You'll set your login password now and can
              log in immediately to upload documents and track approval status — but the full operator dashboard
              only unlocks once the Director of Mobility and Chief Officer both approve.
            </p>
          </div>

          <div className="card p-6 space-y-5 auth-card-enter">
            {state?.error && (
              <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold text-center">
                {state.error}
              </div>
            )}

            <form action={formAction} className="space-y-4">
              <div>
                <label className="label">Is your Operator new to Nairobi County, or already operating here?</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSaccoType("EXISTING")}
                    className={`p-3 rounded-xl border text-center transition-all text-xs ${
                      saccoType === "EXISTING"
                        ? "bg-county-blue border-county-blue text-white font-bold shadow-md"
                        : "bg-black/[0.02] border-county-ink/10 text-county-ink/70 hover:bg-black/5"
                    }`}
                  >
                    <div className="font-extrabold text-sm">Existing Operator</div>
                    <div className="text-[10px] opacity-80 mt-0.5">Already operating in Nairobi</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaccoType("NEW")}
                    className={`p-3 rounded-xl border text-center transition-all text-xs ${
                      saccoType === "NEW"
                        ? "bg-county-green border-county-green text-white font-bold shadow-md"
                        : "bg-black/[0.02] border-county-ink/10 text-county-ink/70 hover:bg-black/5"
                    }`}
                  >
                    <div className="font-extrabold text-sm">New Applicant</div>
                    <div className="text-[10px] opacity-80 mt-0.5">Needs Letter of No Objection</div>
                  </button>
                </div>
                <input type="hidden" name="saccoType" value={saccoType} />
              </div>

              <div>
                <label className="label" htmlFor="saccoName">Operator / Company Name</label>
                <input
                  id="saccoName"
                  className="input"
                  type="text"
                  name="saccoName"
                  required
                  placeholder="e.g. Kilimani Direct Shuttle Operator"
                />
              </div>

              <div>
                <label className="label" htmlFor="name">Your Full Name (Applicant)</label>
                <input
                  id="name"
                  className="input"
                  type="text"
                  name="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Michael Kamande"
                />
              </div>

              <div>
                <label className="label" htmlFor="email">Email Address</label>
                <input id="email" className="input" type="email" name="email" required placeholder="operator@youroperator.co.ke" />
              </div>

              <div>
                <label className="label" htmlFor="password">Set Operator Dashboard Password</label>
                <PasswordInput id="password" name="password" required placeholder="Create a strong password" />
              </div>

              <div className="rounded-lg border border-county-ink/10 bg-county-cream/60 p-3.5 space-y-3">
                <label className="flex items-start gap-2.5 text-xs text-county-ink/70 leading-relaxed cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-county-ink/25 accent-county-green shrink-0"
                  />
                  <span>
                    I have read and agree to the{" "}
                    <Link href="/terms" target="_blank" className="font-bold text-county-green hover:underline">
                      Terms &amp; Conditions
                    </Link>{" "}
                    on behalf of this Operator.
                  </span>
                </label>

                <div>
                  <label className="label" htmlFor="signature">Type your full legal name to sign</label>
                  <input
                    id="signature"
                    className="input"
                    type="text"
                    name="signature"
                    required
                    disabled={!agreedToTerms}
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    placeholder={fullName || "Must exactly match your Full Name above"}
                  />
                  {signature.length > 0 && !signatureMatches && (
                    <p className="text-[11px] text-county-red font-semibold mt-1">
                      Your signature must exactly match the Full Name field above.
                    </p>
                  )}
                </div>
              </div>

              <button type="submit" disabled={!canSubmit} className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2">
                <Building2 size={16} strokeWidth={2} />
                Sign &amp; Submit Onboarding Application
              </button>
            </form>

            <div className="text-center text-xs text-county-ink/55 pt-2 border-t border-black/5">
              Already onboarded?{" "}
              <Link href="/login" className="font-bold text-county-green hover:underline">
                Sign in to Operator Portal
              </Link>
            </div>
          </div>

          <div className="text-center">
            <Link href="/" className="text-xs font-extrabold text-county-green hover:underline inline-flex items-center gap-1">
              <ArrowLeft size={12} strokeWidth={2.5} />
              Back to Sign in
            </Link>
          </div>
        </div>
      </div>
      <PublicFooter transparent />
    </main>
  );
}
