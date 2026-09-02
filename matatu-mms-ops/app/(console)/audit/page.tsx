import type { Metadata } from "next";
import { getAuditLogsPage, getStaffUsers } from "@/lib/data";
import AuditLogViewer from "@/components/AuditLogViewer";

export const metadata: Metadata = { title: "Audit | Ops Console" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const [auditPage, staffUsers] = await Promise.all([getAuditLogsPage(), getStaffUsers()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Audit Trail</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Every create and update recorded across the system, with before and after values. Ops actions record the
          operator&apos;s stated reason alongside the change.
        </p>
      </div>

      <AuditLogViewer initialLogs={auditPage.logs} initialCursor={auditPage.nextCursor} users={staffUsers} />
    </div>
  );
}
