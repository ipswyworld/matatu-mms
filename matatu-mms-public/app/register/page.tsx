"use client";

import { useFormState } from "react-dom";
import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { UserPlus, ArrowLeft } from "lucide-react";
import { registerAction } from "@/lib/actions";
import AuthSkyline from "@/components/AuthSkyline";
import PublicFooter from "@/components/PublicFooter";

// Passenger self-registration only. Crew accounts are issued by the
// operator when they onboard a vehicle (see the Sacco Operator dashboard's
// crew-assignment flow) — a driver/conductor never creates their own
// login, and the backend rejects self-registration with any role other
// than PASSENGER regardless of what this form sends.
//
// The login page's "Citizen" / "Student & Minor" icons both land here with
// a ?type= param. Student/Minor additionally requires guardian details and
// creates the account in a pending state — see login()'s guardian_approved
// gate in the backend. Concessional student fares still aren't available
// online; only the guardian-consent requirement is real so far.
//
// Visual chrome matches the rest of the auth family (forgot-password,
// reset-password): county-cream body, real crest, shared card/input/label/
// btn-primary classes from globals.css — not a bespoke dark theme.
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const searchParams = useSearchParams();
  const isStudent = searchParams.get("type") === "student";
  const [state, formAction] = useFormState(registerAction, undefined);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [fullName, setFullName] = useState("");
  const [signature, setSignature] = useState("");

  const signatureMatches =
    signature.trim().length > 0 && signature.trim().toLowerCase() === fullName.trim().toLowerCase();
  const canSubmit = agreedToTerms && signatureMatches;

  return (
    <main className="relative min-h-screen bg-county-cream flex flex-col overflow-hidden">
      {/* Spans the whole page (form area + footer), not just the card's
          slice, so it reads all the way down to the footer links. */}
      <AuthSkyline heightClassName="h-[70vh]" />
      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="mx-auto object-contain drop-shadow" priority />
            <h1 className="text-2xl font-black tracking-tight text-county-ink">
              {isStudent ? "Create your student / minor account" : "Create your commuter account"}
            </h1>
            <p className="text-sm text-county-ink/55">
              {isStudent
                ? "Book seats, track your matatu live, and report issues to County Traffic Enforcement. Concessional student fares aren't available online yet, this registers a standard passenger account for now."
                : "Book seats, track your matatu live, and report issues directly to County Traffic Enforcement."}
            </p>
          </div>

          <div className="card p-6 space-y-4 auth-card-enter">
            {state?.pendingGuardianApproval ? (
              <div className="text-sm text-county-ink/80 bg-county-green/10 border border-county-green/30 rounded-lg px-3.5 py-3 space-y-1.5">
                <p className="font-bold text-county-green">Account created</p>
                <p>{state.pendingGuardianApproval}</p>
              </div>
            ) : (
              <RegisterFormBody
                state={state}
                formAction={formAction}
                isStudent={isStudent}
                agreedToTerms={agreedToTerms}
                setAgreedToTerms={setAgreedToTerms}
                fullName={fullName}
                setFullName={setFullName}
                signature={signature}
                setSignature={setSignature}
                signatureMatches={signatureMatches}
                canSubmit={canSubmit}
              />
            )}
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

interface RegisterFormBodyProps {
  state: { error?: string; pendingGuardianApproval?: string } | undefined;
  formAction: (formData: FormData) => void;
  isStudent: boolean;
  agreedToTerms: boolean;
  setAgreedToTerms: (v: boolean) => void;
  fullName: string;
  setFullName: (v: string) => void;
  signature: string;
  setSignature: (v: string) => void;
  signatureMatches: boolean;
  canSubmit: boolean;
}

function RegisterFormBody({
  state,
  formAction,
  isStudent,
  agreedToTerms,
  setAgreedToTerms,
  fullName,
  setFullName,
  signature,
  setSignature,
  signatureMatches,
  canSubmit,
}: RegisterFormBodyProps) {
  return (
    <React.Fragment>
      {state?.error && (
        <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="role" value="PASSENGER" />
        <input type="hidden" name="isMinor" value={isStudent ? "true" : "false"} />

        <div>
          <label className="label" htmlFor="name">Full Name</label>
          <input
            className="input"
            id="name"
            type="text"
            name="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. John Kamau"
          />
        </div>

        <div>
          <label className="label" htmlFor="phone">Phone Number</label>
          <input className="input" id="phone" type="tel" name="phone" required placeholder="+254 7XX XXX XXX" />
          <p className="text-[11px] text-county-ink/50 mt-1">Used to sign in and to reset your password by SMS code.</p>
        </div>

        <div>
          <label className="label" htmlFor="email">Email Address (optional)</label>
          <input className="input" id="email" type="email" name="email" placeholder="you@nairobi.go.ke" />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" type="password" name="password" required placeholder="Create a strong password" />
        </div>

        {isStudent && (
          <div className="rounded-lg border border-county-yellow/40 bg-county-yellow/10 p-3.5 space-y-3">
            <p className="text-xs font-bold text-county-ink">
              Guardian details required
            </p>
            <p className="text-[11px] text-county-ink/60 -mt-2">
              Your account won't be usable until your guardian approves it by SMS.
            </p>
            <div>
              <label className="label" htmlFor="guardianName">Guardian Full Name</label>
              <input className="input" id="guardianName" type="text" name="guardianName" required={isStudent} placeholder="e.g. Mary Njeri" />
            </div>
            <div>
              <label className="label" htmlFor="guardianPhone">Guardian Phone Number</label>
              <input className="input" id="guardianPhone" type="tel" name="guardianPhone" required={isStudent} placeholder="+254 7XX XXX XXX" />
            </div>
            <div>
              <label className="label" htmlFor="guardianRelationship">Relationship to You</label>
              <select className="input" id="guardianRelationship" name="guardianRelationship" required={isStudent} defaultValue="">
                <option value="" disabled>Select relationship</option>
                <option value="Parent">Parent</option>
                <option value="Guardian">Guardian</option>
                <option value="Sibling">Sibling</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="guardianIdNumber">Guardian National ID Number</label>
              <input className="input" id="guardianIdNumber" type="text" name="guardianIdNumber" required={isStudent} placeholder="e.g. 12345678" />
            </div>
          </div>
        )}

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
              </Link>
            </span>
          </label>

          <div>
            <label className="label" htmlFor="signature">Type your full legal name to sign</label>
            <input
              className="input"
              id="signature"
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
          <UserPlus size={16} strokeWidth={2} />
          Sign &amp; Register
        </button>
      </form>

      <div className="text-center text-xs text-county-ink/55 pt-2 border-t border-black/5 space-y-1.5">
        <p>
          Matatu crew: your operator issues your login when they onboard your vehicle, no need to register here.
        </p>
      </div>
    </React.Fragment>
  );
}
