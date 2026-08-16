import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import AppShell from "@/components/AppShell";

// Everything under this layout requires a login — keep it out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = readSession();
  if (!session) redirect("/");

  return (
    <AppShell role={session.role} name={session.name} token={session.token}>
      {children}
    </AppShell>
  );
}
