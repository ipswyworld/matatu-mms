"use client";

import { useFormState } from "react-dom";
import { useState } from "react";
import Link from "next/link";
import { registerAction } from "@/lib/actions";
import NairobiCrest from "@/components/NairobiCrest";
import MatatuGlyph from "@/components/MatatuGlyph";
import PublicFooter from "@/components/PublicFooter";

// Passenger self-registration only. Crew accounts are issued by the
// operator when they onboard a vehicle (see the Sacco Operator dashboard's
// crew-assignment flow) — a driver/conductor never creates their own
// login, and the backend rejects self-registration with any role other
// than PASSENGER regardless of what this form sends.
export default function RegisterPage() {
  const [state, formAction] = useFormState(registerAction, undefined);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [fullName, setFullName] = useState("");
  const [signature, setSignature] = useState("");

  const signatureMatches =
    signature.trim().length > 0 && signature.trim().toLowerCase() === fullName.trim().toLowerCase();
  const canSubmit = agreedToTerms && signatureMatches;

  return (
    <main className="min-h-screen bg-county-black text-white flex flex-col justify-center items-center p-4 pb-0 relative overflow-hidden">
      {/* Livery diagonal-stripe texture */}
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

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <NairobiCrest size={52} className="mx-auto drop-shadow-lg" />
          <h1 className="text-xl font-extrabold tracking-tight text-white">Nairobi City County</h1>
          <p className="text-xs font-semibold text-county-yellow uppercase tracking-widest">
            Create Your Commuter Account
          </p>
        </div>

        {/* Form Container */}
        <div className="bg-white/[0.06] border border-white/10 p-6 rounded-2xl shadow-2xl space-y-5">
          <p className="text-xs text-white/60 leading-relaxed">
            Book seats, track your matatu live, and report issues directly to County Traffic Enforcement.
          </p>

          {state?.error && (
            <div className="bg-county-red/20 border border-county-red/40 text-red-200 text-xs p-3 rounded-lg font-semibold text-center">
              {state.error}
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="role" value="PASSENGER" />

            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1">Full Name</label>
              <input
                type="text"
                name="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. John Kamau"
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3.5 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-county-green"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1">Email Address</label>
              <input
                type="email"
                name="email"
                required
                placeholder="commuter@domain.com"
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3.5 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-county-green"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1">Password</label>
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
                  </Link>
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
              Sign & Register — Access Passenger Portal
            </button>
          </form>

          <div className="text-center text-xs text-white/50 pt-2 border-t border-white/10 space-y-1.5">
            <p>
              Already have an account?{" "}
              <Link href="/login" className="font-bold text-county-yellow hover:underline">
                Sign in to Portal →
              </Link>
            </p>
            <p>
              Matatu crew: your operator issues your login when they onboard your vehicle — no need to register here.
            </p>
          </div>
        </div>
      </div>
      <div className="relative z-10 w-full mt-8">
        <PublicFooter dark />
      </div>
    </main>
  );
}
