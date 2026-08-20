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
          Sacco/fleet/commuter accounts, not county staff, and each is managed in a different place:
          <ul className="mt-1.5 space-y-1 list-disc list-inside">
            <li>
              <strong className="text-county-ink">{operatorCount} operator{operatorCount !== 1 ? "s" : ""}</strong> — reviewed and approved at the{" "}
              <Link href="/saccos/verify" className="font-bold text-county-green hover:underline inline-flex items-center gap-1">
                <Bus size={12} strokeWidth={2.5} />
                Sacco verification hub
              </Link>
              . Open any operator card there and expand <strong className="text-county-ink">"Crew (Drivers &amp; Conductors)"</strong> to see every crew account that operator has issued.
            </li>
            <li>
              <strong className="text-county-ink">{crewCount} crew account{crewCount !== 1 ? "s" : ""}</strong> — issued and revoked directly by their own Sacco operator from the Operator Dashboard. County admin can view them (via the verification hub above) but doesn't create or edit them.
            </li>
            <li>
              <strong className="text-county-ink">{passengerCount} passenger{passengerCount !== 1 ? "s" : ""}</strong> — self-register from the public commuter portal; there's no admin management screen for them by design.
            </li>
          </ul>
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
