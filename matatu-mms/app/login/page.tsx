"use client";

import Link from "next/link";
import AuthPageShell from "@/components/AuthPageShell";
import LoginForm from "@/components/LoginForm";
import DemoAccountsList from "@/components/DemoAccountsList";
import { useLanguage } from "@/components/LanguageProvider";

// The public app is a separate deployment/origin now — a plain relative
// link can't reach it, so its full URL has to come from an env var (same
// pattern as BACKEND_URL). Falls back to the local public app's default
// dev port for local development.
const PUBLIC_APP_URL = process.env.NEXT_PUBLIC_PUBLIC_APP_URL || "http://localhost:3001";

const STAFF_DEMO_ACCOUNTS = [
  { role: "Admin", email: "admin@nairobi.go.ke", password: "admin123" },
  { role: "Enforcement Officer", email: "enforcement@nairobi.go.ke", password: "enforce123" },
  { role: "Viewer / Executive", email: "viewer@nairobi.go.ke", password: "viewer123" },
  { role: "Director of Mobility", email: "director.mobility@nairobi.go.ke", password: "director123" },
  { role: "Chief Officer", email: "chiefofficer@nairobi.go.ke", password: "chief123" },
  { role: "Enforcement Commander", email: "commander@nairobi.go.ke", password: "commander123" },
  { role: "Arresting Officer", email: "arresting.officer@nairobi.go.ke", password: "arrest123" },
  { role: "Releasing Officer", email: "releasing.officer@nairobi.go.ke", password: "release123" },
];

// Staff-only entry point — Admin, Enforcement (all sub-roles), Director of
// Mobility, Chief Officer, Viewer/Superadmin. Public roles (Passenger, Crew,
// Sacco Operator) sign in at "/" instead — see the public/staff front-door
// split. Same loginAction, same backend, same middleware-driven post-login
// redirect either way; only this page's framing differs.
export default function StaffLoginPage() {
  const { t } = useLanguage();

  return (
    <AuthPageShell
      eyebrow="County Staff Portal"
      heading={t("staff.heading")}
      subheading={t("staff.subheading")}
    >
      <LoginForm tagline={t("staff.useCredentials")} />

      <div className="text-center">
        <a href={PUBLIC_APP_URL} className="block text-xs font-extrabold text-county-green hover:underline">
          {t("staff.publicLink")}
        </a>
      </div>

      <DemoAccountsList accounts={STAFF_DEMO_ACCOUNTS} />
    </AuthPageShell>
  );
}
