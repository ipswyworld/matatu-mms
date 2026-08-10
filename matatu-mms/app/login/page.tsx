"use client";

import Image from "next/image";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "@/lib/actions";

const DEMO_ACCOUNTS = [
  { role: "Admin", email: "admin@nairobi.go.ke", password: "admin123" },
  { role: "Enforcement Officer", email: "enforcement@nairobi.go.ke", password: "enforce123" },
  { role: "Sacco Operator", email: "operator@umoinner.co.ke", password: "sacco123" },
  { role: "Commuter Passenger", email: "commuter@nairobi.go.ke", password: "pass123" },
  { role: "Driver / Conductor Crew", email: "crew@umoinner.co.ke", password: "crew123" },
  { role: "Viewer / Executive", email: "viewer@nairobi.go.ke", password: "viewer123" },
  { role: "Director of Mobility", email: "director.mobility@nairobi.go.ke", password: "director123" },
  { role: "Chief Officer", email: "chiefofficer@nairobi.go.ke", password: "chief123" },
  { role: "Sacco Operator (pending onboarding)", email: "operator@kilimanidirect.co.ke", password: "sacco123" },
  { role: "Enforcement Commander", email: "commander@nairobi.go.ke", password: "commander123" },
  { role: "Arresting Officer", email: "arresting.officer@nairobi.go.ke", password: "arrest123" },
  { role: "Releasing Officer", email: "releasing.officer@nairobi.go.ke", password: "release123" },
  { role: "Data Analyst", email: "analyst@nairobi.go.ke", password: "analyst123" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base" disabled={pending}>
      {pending ? "Signing in..." : "Sign in"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState(loginAction, undefined);

  return (
    <div className="min-h-screen flex bg-county-cream">
      {/* Left brand panel — deep green with hex lattice and real crest */}
      <div className="relative hidden lg:flex lg:w-[46%] flex-col justify-between bg-county-green-deep text-white p-12 overflow-hidden">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.05]"
          viewBox="0 0 400 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <pattern id="loginhex" x="0" y="0" width="72" height="62" patternUnits="userSpaceOnUse">
              <path d="M36 0 L72 18 L72 54 L36 72 L0 54 L0 18 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </pattern>
          </defs>
          <rect width="400" height="800" fill="url(#loginhex)" />
        </svg>

        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-county-yellow/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-county-green/40 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-county-cream flex items-center justify-center overflow-hidden shadow-lg">
              <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="object-contain" priority />
            </div>
            <div className="leading-tight">
              <div className="font-black text-white text-base">Nairobi City County</div>
              <div className="text-[11px] font-bold text-county-yellow tracking-[0.18em] uppercase mt-0.5">Government</div>
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-county-yellow mb-3">
            Matatu Management System
          </div>
          <h1 className="text-[42px] leading-[1.05] font-black tracking-tight text-balance">
            One county, one live view of every matatu.
          </h1>
          <p className="text-white/70 text-[15px] leading-relaxed mt-5 max-w-md">
            Fleet registration, live GPS telemetry, seat booking, fare compliance and enforcement,
            all on one real-time backbone connecting officers, saccos, crew and commuters.
          </p>
        </div>

        <div className="relative">
          <div className="h-1.5 w-24 rounded-full overflow-hidden flex">
            <div className="bg-county-green flex-1" />
            <div className="bg-county-yellow flex-1" />
            <div className="bg-county-red flex-1" />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40 mt-3">
            County of Nairobi · Kenya
          </div>
        </div>
      </div>

      {/* Right sign-in panel */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md space-y-8">
          <div className="flex lg:hidden items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-white flex items-center justify-center overflow-hidden shadow-md">
              <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={44} height={44} className="object-contain" />
            </div>
            <div className="leading-tight">
              <div className="font-black text-county-ink">Nairobi City County</div>
              <div className="text-[10px] font-bold text-county-green tracking-widest uppercase">Matatu MMS</div>
            </div>
          </div>

          <div>
            <h2 className="text-3xl font-black tracking-tight text-county-ink">Sign in</h2>
            <p className="text-sm text-county-ink/55 mt-2">Use your county-issued credentials to continue.</p>
          </div>

          <form action={formAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input className="input" id="email" name="email" type="email" placeholder="you@nairobi.go.ke" required />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input className="input" id="password" name="password" type="password" placeholder="••••••••" required />
            </div>

            {state?.error && (
              <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
                {state.error}
              </div>
            )}

            <SubmitButton />
          </form>

          <div className="text-center space-y-1.5">
            <a href="/register" className="block text-xs font-extrabold text-county-green hover:underline">
              New here? Register as Commuter or Matatu Crew →
            </a>
            <a href="/operator-onboarding" className="block text-xs font-extrabold text-county-blue hover:underline">
              Sacco / Operator? Start Onboarding & Verification →
            </a>
          </div>

          <details className="rounded-xl border border-county-ink/10 bg-white/60 group">
            <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-county-ink/60">
              <span>Demo accounts</span>
              <span className="text-county-green group-open:rotate-45 transition-transform text-lg leading-none">+</span>
            </summary>
            <ul className="px-4 pb-4 space-y-1.5 text-xs text-county-ink/70">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email} className="flex justify-between gap-2">
                  <span className="font-semibold text-county-ink/80">{a.role}</span>
                  <span className="font-mono text-[11px]">{a.email} / {a.password}</span>
                </li>
              ))}
            </ul>
          </details>

          <div className="flex items-center justify-center gap-3 text-[11px] font-bold text-county-ink/40">
            <a href="/faq" className="hover:text-county-green hover:underline">Help &amp; FAQ</a>
            <span>·</span>
            <a href="/terms" className="hover:text-county-green hover:underline">Terms &amp; Conditions</a>
          </div>
        </div>
      </div>
    </div>
  );
}
