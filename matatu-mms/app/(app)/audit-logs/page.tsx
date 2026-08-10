import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getAuditLogs, getMatatus, getUsers } from "@/lib/data";
import PageBanner from "@/components/PageBanner";
import AuditLogTable from "@/components/AuditLogTable";

export default async function AuditLogsPage() {
  const session = readSession()!;

  // Defence in depth: double check role (Admin, plus read-only Data Analyst access)
  if (session.role !== "ADMIN" && session.role !== "DATA_ANALYST") {
    redirect("/dashboard");
  }

  const [logs, users, matatus] = await Promise.all([
    getAuditLogs(),
    getUsers(),
    getMatatus(),
  ]);

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
        subtitle={`${logs.length} system audit trail record${logs.length !== 1 ? "s" : ""} — every status change and creation across the platform.`}
      />

      <AuditLogTable rows={rows} />
    </div>
  );
}
