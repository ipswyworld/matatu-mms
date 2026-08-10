import { getSaccos, getUsers } from "@/lib/data";
import NewUserForm from "./NewUserForm";
import PageBanner from "@/components/PageBanner";
import UsersTable from "@/components/UsersTable";

export default async function UsersPage() {
  const [users, saccos] = await Promise.all([
    getUsers(),
    getSaccos(),
  ]);

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Administration"
        title="Users & Roles"
        subtitle={`${users.length} account${users.length !== 1 ? "s" : ""} across every role in the system.`}
      />
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <UsersTable users={users} saccos={saccos} />
        </div>
        <NewUserForm saccos={saccos} />
      </div>
    </div>
  );
}
