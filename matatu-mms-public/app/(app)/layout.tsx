import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getNotificationHistory } from "@/lib/data";
import AppShell from "@/components/AppShell";
import PassengerShell from "@/components/PassengerShell";

// Everything under this layout requires a login — keep it out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = readSession();
  if (!session) redirect("/");

  const notificationHistory = session.token ? await getNotificationHistory() : { items: [], unreadCount: 0 };

  // Passengers get a lighter, mobile-first shell (bottom tab bar, no
  // persistent sidebar) — their entire nav is 2 items, so the
  // sidebar-based AppShell that CREW/SACCO_OPERATOR use would be an
  // oversized admin shell around a single-purpose consumer flow. Both
  // roles below are completely unaffected by this branch.
  if (session.role === "PASSENGER") {
    return (
      <PassengerShell name={session.name} token={session.token} notificationHistory={notificationHistory}>
        {children}
      </PassengerShell>
    );
  }

  return (
    <AppShell role={session.role} name={session.name} token={session.token} notificationHistory={notificationHistory}>
      {children}
    </AppShell>
  );
}
