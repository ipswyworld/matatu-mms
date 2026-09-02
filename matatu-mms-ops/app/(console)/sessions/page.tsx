import type { Metadata } from "next";
import { getStaffUsers, getLoginOverview } from "@/lib/data";
import SessionControlPanel from "@/components/SessionControlPanel";
import PrivilegedActivityPanel from "@/components/PrivilegedActivityPanel";
import ImpersonationPanel from "@/components/ImpersonationPanel";
import PanelError, { settle } from "@/components/PanelError";

export const metadata: Metadata = { title: "Sessions | Ops Console" };
export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const [staffUsers, loginOverview] = await Promise.all([
    settle(getStaffUsers()),
    settle(getLoginOverview()),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Sessions &amp; Accounts</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Sign-in activity, account containment controls, and support impersonation.
        </p>
      </div>

      {loginOverview.data ? (
        <PrivilegedActivityPanel overview={loginOverview.data} />
      ) : (
        <PanelError title="Privileged activity" error={loginOverview.error!} />
      )}

      {staffUsers.data ? (
        <>
          <SessionControlPanel users={staffUsers.data} />
          <ImpersonationPanel staff={staffUsers.data} />
        </>
      ) : (
        <PanelError title="Account controls" error={staffUsers.error!} />
      )}
    </div>
  );
}
