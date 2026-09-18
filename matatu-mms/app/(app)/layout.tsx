import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getSaccos, getNotificationHistory } from "@/lib/data";
import { can } from "@/lib/rbac";
import AppShell from "@/components/AppShell";
import ImpersonationBanner from "@/components/ImpersonationBanner";

// Everything under this layout requires a login — keep it out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = readSession();
  if (!session) redirect("/login");

  const notificationHistory = session.token ? await getNotificationHistory() : { items: [], unreadCount: 0 };

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
    <>
      {session.impersonatedBy && (
        <ImpersonationBanner targetName={session.name} impersonatorName={session.impersonatedBy.name} />
      )}
      <AppShell role={session.role} additionalRoles={session.additionalRoles} name={session.name} token={session.token} actionNeeded={actionNeeded} notificationHistory={notificationHistory}>
        {children}
      </AppShell>
    </>
  );
}
