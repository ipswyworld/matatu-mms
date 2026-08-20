import type { Metadata } from "next";
import Link from "next/link";
import { Users as UsersIcon, Bus, Info } from "lucide-react";
import { getSaccos, getUsers } from "@/lib/data";
import { readSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import NewUserForm from "./NewUserForm";
import PageBanner from "@/components/PageBanner";
import UsersTable from "@/components/UsersTable";

export const metadata: Metadata = { title: "Users & Roles" };

export default async function UsersPage() {
  const session = readSession()!;
  const [allUsers, saccos] = await Promise.all([
    getUsers(),
    getSaccos(),
  ]);

  // County staff/government accounts only — Sacco operators, crew, and
  // passengers have their own accounts with a different lifecycle and are
  // managed elsewhere (see the note below), never mixed into this roster.
  const users = allUsers.filter((u) => STAFF_ROLES.includes(u.role));
  const operatorCount = allUsers.filter((u) => u.role === "SACCO_OPERATOR").length;
  const crewCount = allUsers.filter((u) => u.role === "CREW").length;
  const passengerCount = allUsers.filter((u) => u.role === "PASSENGER").length;

  return (
    <div className="space-y-6">
      <PageBanner
        icon={UsersIcon}
        eyebrow="Nairobi City County · Administration"
        title="Users & Roles"
        subtitle={`${users.length} county staff account${users.length !== 1 ? "s" : ""} across every government role in the system.`}
      />

      <div className="card p-4 flex items-start gap-3 text-xs text-county-ink/60">
        <Info size={16} strokeWidth={2} className="text-county-ink/40 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-county-ink">Sacco operators, crew, and passengers aren't listed here</span> — they're
          Sacco/fleet/commuter accounts, not county staff. {operatorCount} operator{operatorCount !== 1 ? "s" : ""} are onboarded via the{" "}
          <Link href="/saccos/verify" className="font-bold text-county-green hover:underline inline-flex items-center gap-1">
            <Bus size={12} strokeWidth={2.5} />
            Sacco verification hub
          </Link>
          , {crewCount} crew account{crewCount !== 1 ? "s" : ""} are issued by their own Sacco operator, and {passengerCount} passenger{passengerCount !== 1 ? "s" : ""} self-register from the public portal.
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-w-0">
          <UsersTable users={users} saccos={saccos} viewerRole={session.role} viewerUserId={session.userId} />
        </div>
        <NewUserForm saccos={saccos} viewerRole={session.role} />
      </div>
    </div>
  );
}
