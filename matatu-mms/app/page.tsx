"use client";

import Link from "next/link";
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

      <div className="text-center space-y-1.5">
        <Link href="/register" className="block text-xs font-extrabold text-county-green hover:underline">
          {t("portal.registerLink")}
        </Link>
        <Link href="/operator-onboarding" className="block text-xs font-extrabold text-county-blue hover:underline">
          {t("portal.onboardingLink")}
        </Link>
      </div>

      <DemoAccountsList accounts={PUBLIC_DEMO_ACCOUNTS} />
    </AuthPageShell>
  );
}
