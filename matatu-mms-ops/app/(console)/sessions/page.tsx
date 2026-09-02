import type { Metadata } from "next";
import { getStaffUsers, getLoginOverview } from "@/lib/data";
import SessionControlPanel from "@/components/SessionControlPanel";
import PrivilegedActivityPanel from "@/components/PrivilegedActivityPanel";
import ImpersonationPanel from "@/components/ImpersonationPanel";

export const metadata: Metadata = { title: "Sessions | Ops Console" };
export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const [staffUsers, loginOverview] = await Promise.all([getStaffUsers(), getLoginOverview()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Sessions &amp; Accounts</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Sign-in activity, account containment controls, and support impersonation.
        </p>
      </div>

      <PrivilegedActivityPanel overview={loginOverview} />
      <SessionControlPanel users={staffUsers} />
      <ImpersonationPanel staff={staffUsers} />
    </div>
  );
}
