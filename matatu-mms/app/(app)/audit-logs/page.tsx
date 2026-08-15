import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getAuditLogs, getMatatus, getUsers } from "@/lib/data";
import PageBanner from "@/components/PageBanner";
import AuditLogTable from "@/components/AuditLogTable";

export const metadata: Metadata = { title: "System Audit Trail" };

export default async function AuditLogsPage() {
  const session = readSession()!;

  // Defence in depth: double check role. No nav link points here anymore
  // (removed as admin-nav clutter), but the page and underlying audit data
  // stay reachable directly for admins.
  if (session.role !== "ADMIN" && session.role !== "SUPERADMIN") {
    redirect("/dashboard");
  }

  // Keyset-paginated on the backend (most recent first, id-cursored — see
  // GET /api/audit-logs) rather than the full table. This page doesn't yet
  // have a "load more" control, so it shows the most recent 500 with a
  // note when the trail is longer than that, rather than silently
  // truncating with no indication.
  const AUDIT_LOG_PAGE_SIZE = 500;
  const [logs, users, matatus] = await Promise.all([
    getAuditLogs(AUDIT_LOG_PAGE_SIZE),
    getUsers(),
    getMatatus(),
  ]);
  const truncated = logs.length === AUDIT_LOG_PAGE_SIZE;

  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const matatuMap = new Map(matatus.map((m) => [m.id, m]));

  const rows = logs.map((log) => {
    const userName = userMap.get(log.userId) || log.userId;
    let resourceLabel = `${log.resourceType} (${log.resourceId})`;
    if (log.resourceType === "matatu") {
      const m = matatuMap.get(log.resourceId);
      if (m) resourceLabel = `Matatu: ${m.regNumber}`;
    } else if (log.resourceType === "fine") {
      resourceLabel = `Fine ID: ${log.resourceId}`;
    }
    return { log, userName, resourceLabel };
  });

  return (
    <div className="space-y-4">
      <PageBanner
        eyebrow="Nairobi City County · System Audit"
        title="Audit Trail"
        subtitle={
          truncated
            ? `Showing the most recent ${AUDIT_LOG_PAGE_SIZE} audit trail records — the full history is longer. Use the API's before_id cursor to page further back.`
            : `${logs.length} system audit trail record${logs.length !== 1 ? "s" : ""} — every status change and creation across the platform.`
        }
      />

      <AuditLogTable rows={rows} />
    </div>
  );
}
