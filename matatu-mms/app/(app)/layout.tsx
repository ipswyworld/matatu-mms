import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const session = readSession();
  if (!session) redirect("/login");

  return (
    <div className="flex">
      <Sidebar role={session.role} />
      <div className="flex-1 min-w-0">
        <Header name={session.name} role={session.role} token={session.token} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
