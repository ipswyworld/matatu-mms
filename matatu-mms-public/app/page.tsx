"use client";

import Link from "next/link";
import { Users, GraduationCap, Briefcase } from "lucide-react";
import AuthPageShell from "@/components/AuthPageShell";
import LoginForm from "@/components/LoginForm";
import DemoAccountsList from "@/components/DemoAccountsList";
import { useLanguage } from "@/components/LanguageProvider";

const PUBLIC_DEMO_ACCOUNTS = [
  { role: "Commuter Passenger", email: "commuter@nairobi.go.ke", password: "pass123" },
  { role: "Driver / Conductor Crew", email: "crew@umoinner.co.ke", password: "crew123" },
  { role: "Operator", email: "operator@umoinner.co.ke", password: "sacco123" },
  { role: "Operator (pending onboarding)", email: "operator@kilimanidirect.co.ke", password: "sacco123" },
];

// Public front door — Passengers, Crew (sign in only; accounts are issued
// by their operator, not self-registered here — see /register), and Sacco
// Operators (external businesses, not county staff). County staff sign in
// at /login instead. Same loginAction/backend as the staff page; only the
// framing, links, and demo accounts differ.
export default function PublicPortalPage() {
  const { t } = useLanguage();

  return (
    <AuthPageShell
      eyebrow="Government"
      heading={t("portal.heading")}
      subheading={t("portal.subheading")}
      showLeaveComment
    >
      <LoginForm tagline={t("portal.useCredentials")} />

      <div className="space-y-3">
        <div className="flex justify-center">
          <span className="inline-block text-[10px] font-extrabold uppercase tracking-wide text-county-black bg-county-yellow px-2.5 py-1 rounded-full">
            {t("portal.newHere")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Link
            href="/register?type=citizen"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-county-green/20 bg-county-green/5 px-3 py-3 text-center transition-all duration-200 hover:border-county-yellow/60 hover:bg-county-yellow/15 hover:shadow-md motion-safe:hover:-translate-y-0.5 active:scale-[0.98]"
          >
            <Users size={20} strokeWidth={2} className="text-county-green" />
            <span className="text-[11px] font-extrabold text-county-green leading-tight">
              {t("portal.registerCitizenLink")}
            </span>
          </Link>
          <Link
            href="/register?type=student"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-county-yellow/30 bg-county-yellow/10 px-3 py-3 text-center transition-all duration-200 hover:border-county-yellow/70 hover:bg-county-yellow/25 hover:shadow-md motion-safe:hover:-translate-y-0.5 active:scale-[0.98]"
          >
            <GraduationCap size={20} strokeWidth={2} className="text-county-black" />
            <span className="text-[11px] font-extrabold text-county-black leading-tight">
              {t("portal.registerStudentLink")}
            </span>
          </Link>
        </div>
        <Link
          href="/operator-onboarding"
          className="flex items-center justify-center gap-1.5 text-xs font-extrabold text-county-blue hover:underline"
        >
          <Briefcase size={13} strokeWidth={2.5} />
          {t("portal.onboardingLink")}
        </Link>
      </div>

      <DemoAccountsList accounts={PUBLIC_DEMO_ACCOUNTS} />
    </AuthPageShell>
  );
}
