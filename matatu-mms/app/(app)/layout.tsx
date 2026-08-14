import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getSaccos } from "@/lib/data";
import { can } from "@/lib/rbac";
import AppShell from "@/components/AppShell";

// Everything under this layout requires a login — keep it out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = readSession();
  if (!session) redirect("/login");

  let actionNeeded: { count: number; message: string; href: string } | undefined;
  if (can(session.role, "verify_saccos") || can(session.role, "view_operator_verification")) {
    const saccos = await getSaccos();
    const pendingSaccos = saccos.filter((s) => s.status === "PENDING_VERIFICATION").length;
    const pendingRenewals = saccos.filter((s) => s.licenseStatus === "RENEWAL_SUBMITTED").length;
    const count = pendingSaccos + pendingRenewals;
    if (count > 0) {
      actionNeeded = {
        count,
        message: `${pendingSaccos} operator application${pendingSaccos !== 1 ? "s" : ""} · ${pendingRenewals} license renewal${pendingRenewals !== 1 ? "s" : ""} awaiting your review.`,
        href: "/saccos/verify",
      };
    }
  }

  return (
    <AppShell role={session.role} name={session.name} token={session.token} actionNeeded={actionNeeded}>
      {children}
    </AppShell>
  );
}
