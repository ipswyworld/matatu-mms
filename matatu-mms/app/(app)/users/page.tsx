import type { Metadata } from "next";
import { Users as UsersIcon } from "lucide-react";
import { getSaccos, getUsers } from "@/lib/data";
import { readSession } from "@/lib/session";
import NewUserForm from "./NewUserForm";
import PageBanner from "@/components/PageBanner";
import UsersTable from "@/components/UsersTable";

export const metadata: Metadata = { title: "Users & Roles" };

export default async function UsersPage() {
  const session = readSession()!;
  const [users, saccos] = await Promise.all([
    getUsers(),
    getSaccos(),
  ]);

  return (
    <div className="space-y-6">
      <PageBanner
        icon={UsersIcon}
        eyebrow="Nairobi City County · Administration"
        title="Users & Roles"
        subtitle={`${users.length} account${users.length !== 1 ? "s" : ""} across every role in the system.`}
      />
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-w-0">
          <UsersTable users={users} saccos={saccos} viewerRole={session.role} />
        </div>
        <NewUserForm saccos={saccos} viewerRole={session.role} />
      </div>
    </div>
  );
}
