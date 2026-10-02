import type { Metadata } from "next";
import Link from "next/link";
import { Users as UsersIcon, ScrollText } from "lucide-react";
import { getSaccos, getUsers, getFeatureFlagEnabled } from "@/lib/data";
import { readSession } from "@/lib/session";
import { STAFF_ROLES, can } from "@/lib/rbac";
import NewUserForm from "./NewUserForm";
import PageBanner from "@/components/PageBanner";
import UsersTable from "@/components/UsersTable";
import PublicDirectoryTable from "@/components/PublicDirectoryTable";
import RoleMatrix from "@/components/RoleMatrix";
import UsersTabs from "@/components/UsersTabs";

export const metadata: Metadata = { title: "Users & Roles" };

export default async function UsersPage() {
  const session = readSession()!;
  const [allUsers, saccos, showRoleMatrix] = await Promise.all([
    getUsers(),
    getSaccos(),
    getFeatureFlagEnabled("staff_role_matrix_enabled"),
  ]);

  // County staff/government accounts vs public (Sacco/fleet/commuter)
  // accounts — two different lifecycles, formalized as tabs on one page
  // rather than staff-only with a footnote about the rest. See STAFF_ROLES.
  const staffUsers = allUsers.filter((u) => STAFF_ROLES.includes(u.role));
  const publicUsers = allUsers.filter((u) => !STAFF_ROLES.includes(u.role));

  return (
    <div className="space-y-6">
      <PageBanner
        icon={UsersIcon}
        eyebrow="Nairobi City County · Administration"
        title="Users & Roles"
        subtitle={`${staffUsers.length} county staff account${staffUsers.length !== 1 ? "s" : ""} · ${publicUsers.length} public account${publicUsers.length !== 1 ? "s" : ""} (Operators, Crew, Passengers).`}
        // Deliberately not restored to primary nav (SYSTEM_AUDIT.md flagged
        // the old global table as "removed as noise") — the per-user
        // Activity tab (Edit User → Activity) is where each role would
        // already be looking for the relevant slice. This is the
        // power-user/compliance escape hatch to the full flat table,
        // reachable exactly where someone thinking about audit already is.
        action={
          can(session.role, "view_audit_logs") ? (
            <Link href="/audit-logs" className="flex items-center gap-1.5 text-xs font-bold text-white/80 hover:text-white">
              <ScrollText size={14} strokeWidth={2} />
              Full audit trail →
            </Link>
          ) : undefined
        }
      />

      <UsersTabs
        staffCount={staffUsers.length}
        publicCount={publicUsers.length}
        staffPanel={
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 min-w-0">
              <UsersTable users={staffUsers} saccos={saccos} viewerRole={session.role} viewerUserId={session.userId} />
            </div>
            <NewUserForm viewerRole={session.role} />
          </div>
        }
        publicPanel={<PublicDirectoryTable users={publicUsers} saccos={saccos} />}
        roleMatrixPanel={<RoleMatrix />}
        showRoleMatrix={showRoleMatrix}
      />
    </div>
  );
}
