import type { Metadata } from "next";
import { Users as UsersIcon } from "lucide-react";
import { getSaccos, getUsers } from "@/lib/data";
import { readSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import NewUserForm from "./NewUserForm";
import PageBanner from "@/components/PageBanner";
import UsersTable from "@/components/UsersTable";
import PublicDirectoryTable from "@/components/PublicDirectoryTable";
import UsersTabs from "@/components/UsersTabs";

export const metadata: Metadata = { title: "Users & Roles" };

export default async function UsersPage() {
  const session = readSession()!;
  const [allUsers, saccos] = await Promise.all([
    getUsers(),
    getSaccos(),
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
      />
    </div>
  );
}
