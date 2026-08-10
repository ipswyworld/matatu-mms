"use client";

import { useFormState } from "react-dom";
import { useState } from "react";
import Link from "next/link";
import { operatorOnboardingRegisterAction } from "@/lib/actions";
import NairobiCrest from "@/components/NairobiCrest";
import MatatuGlyph from "@/components/MatatuGlyph";

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
    <main className="min-h-screen bg-county-black text-white flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, #FCDD07 0px, #FCDD07 14px, transparent 14px, transparent 28px)",
        }}
      />
      <div className="pointer-events-none absolute -right-10 -bottom-10 text-white opacity-[0.08]">
        <MatatuGlyph size={280} />
      </div>

      <div className="w-full max-w-lg space-y-6 relative z-10">
        <div className="text-center space-y-2">
          <NairobiCrest size={52} className="mx-auto drop-shadow-lg" />
          <h1 className="text-xl font-extrabold tracking-tight text-white">Nairobi City County</h1>
          <p className="text-xs font-semibold text-county-yellow uppercase tracking-widest">
            Sacco / Operator Onboarding & Verification
          </p>
        </div>

        <div className="bg-white/[0.06] border border-white/10 p-6 rounded-2xl shadow-2xl space-y-5">
          <div className="text-xs text-white/60 bg-black/30 border border-white/10 rounded-lg p-3 leading-relaxed">
            Register your Sacco here to begin county verification. You&apos;ll set your login password now and can log
            in immediately to upload documents and track approval status — but the full operator dashboard (vehicle
            onboarding, revenue, routes) only unlocks once the Director of Mobility and Chief Officer both approve.
          </div>

          {state?.error && (
            <div className="bg-county-red/20 border border-county-red/40 text-red-200 text-xs p-3 rounded-lg font-semibold text-center">
              {state.error}
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-white/70 block mb-2">
                Is your Sacco new to Nairobi County, or already operating here?
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSaccoType("EXISTING")}
                  className={`p-3 rounded-xl border text-center transition-all text-xs ${
                    saccoType === "EXISTING"
                      ? "bg-county-blue border-county-blue text-white font-bold shadow-md"
                      : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
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
                      : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                  }`}
                >
                  <div className="font-extrabold text-sm">New Applicant</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Needs Letter of No Objection</div>
                </button>
              </div>
              <input type="hidden" name="saccoType" value={saccoType} />
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1">Sacco / Company Name</label>
              <input
                type="text"
                name="saccoName"
                required
                placeholder="e.g. Kilimani Direct Shuttle Sacco"
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3.5 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-county-green"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1">Your Full Name (Applicant)</label>
              <input
                type="text"
                name="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Michael Kamande"
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3.5 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-county-green"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1">Email Address</label>
              <input
                type="email"
                name="email"
                required
                placeholder="operator@yoursacco.co.ke"
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3.5 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-county-green"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1">Set Operator Dashboard Password</label>
              <input
                type="password"
                name="password"
                required
                placeholder="Create a strong password"
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3.5 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-county-green"
              />
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3.5 space-y-3">
              <label className="flex items-start gap-2.5 text-xs text-white/70 leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/30 bg-black/40 accent-county-green shrink-0"
                />
                <span>
                  I have read and agree to the{" "}
                  <Link href="/terms" target="_blank" className="font-bold text-county-yellow hover:underline">
                    Terms &amp; Conditions
                  </Link>{" "}
                  on behalf of this Sacco.
                </span>
              </label>

              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1">
                  Type your full legal name to sign
                </label>
                <input
                  type="text"
                  name="signature"
                  required
                  disabled={!agreedToTerms}
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder={fullName || "Must exactly match your Full Name above"}
                  className="w-full bg-black/40 border border-white/15 rounded-lg px-3.5 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-county-yellow disabled:opacity-40"
                />
                {signature.length > 0 && !signatureMatches && (
                  <p className="text-[11px] text-county-red font-semibold mt-1">
                    Your signature must exactly match the Full Name field above.
                  </p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-2.5 rounded-lg font-extrabold text-sm text-white shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-county-green hover:bg-county-green/90"
            >
              Sign & Submit Onboarding Application
            </button>
          </form>

          <div className="text-center text-xs text-white/50 pt-2 border-t border-white/10">
            Already onboarded?{" "}
            <Link href="/login" className="font-bold text-county-yellow hover:underline">
              Sign in to Operator Portal →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
