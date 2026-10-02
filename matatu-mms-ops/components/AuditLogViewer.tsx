"use client";

import { useMemo, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { AuditLog, StaffUser } from "@/lib/types";
import { loadMoreAuditLogsAction } from "@/lib/actions";
import { downloadCsv, downloadExcel } from "@/lib/csvExport";

export default function AuditLogViewer({
  initialLogs,
  initialCursor,
  users,
}: {
  initialLogs: AuditLog[];
  initialCursor: number | null;
  users: StaffUser[];
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [cursor, setCursor] = useState(initialCursor);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const nameFor = (userId: string) => (userId === "SYSTEM" ? "System" : userMap.get(userId) || userId);
  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))), [logs]);

  const filtered = logs.filter((log) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || nameFor(log.userId).toLowerCase().includes(q) || `${log.resourceType}/${log.resourceId}`.toLowerCase().includes(q);
    const matchesAction = !actionFilter || log.action === actionFilter;
    return matchesQuery && matchesAction;
  });

  function loadMore() {
    if (!cursor || isPending) return;
    startTransition(async () => {
      const page = await loadMoreAuditLogsAction(cursor);
      setLogs((prev) => [...prev, ...page.logs]);
      setCursor(page.nextCursor);
    });
  }

  // Exports exactly what's currently visible (respecting the search/action
  // filters) — not the full unfiltered history, which could be much larger
  // than what's loaded on the page at all.
  const exportRows = (): { headers: string[]; rows: (string | number)[][] } => ({
    headers: ["Timestamp", "User", "Action", "Resource"],
    rows: filtered.map((log) => [
      new Date(log.timestamp).toLocaleString(),
      nameFor(log.userId),
      log.action,
      `${log.resourceType}/${log.resourceId}`,
    ]),
  });

  function exportCsv() {
    const { headers, rows } = exportRows();
    downloadCsv("audit-trail", headers, rows);
  }

  function exportExcel() {
    const { headers, rows } = exportRows();
    downloadExcel("audit-trail", headers, rows);
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-5 pb-0">
        <h3 className="font-bold text-sm text-county-black">Audit Trail</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Every create/update recorded across the system, with before/after values — most recent first.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 items-center p-5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by user or resource…"
          className="input flex-1 min-w-[200px]"
        />
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="input w-48">
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <span className="text-xs font-bold text-black/40">{filtered.length} of {logs.length} loaded</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="rounded-lg border border-black/10 bg-black/[0.02] hover:bg-black/5 px-2.5 py-1.5 text-[11px] font-bold text-county-black flex items-center gap-1 disabled:opacity-40"
          >
            <Download size={12} strokeWidth={2.5} />
            CSV
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={filtered.length === 0}
            className="rounded-lg border border-black/10 bg-black/[0.02] hover:bg-black/5 px-2.5 py-1.5 text-[11px] font-bold text-county-black flex items-center gap-1 disabled:opacity-40"
          >
            <Download size={12} strokeWidth={2.5} />
            Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider text-black/40 border-t border-black/5">
              <th className="px-5 py-2">Timestamp</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Resource</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {filtered.map((log) => (
              <tr key={log.id}>
                <td className="px-5 py-2.5 text-xs text-black/50 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-xs font-semibold text-county-black">{nameFor(log.userId)}</td>
                <td className="px-3 py-2.5">
                  <span className={`badge text-[10px] font-bold ${log.action === "CREATE" ? "bg-county-green/10 text-county-green" : log.action.includes("FAILED") ? "bg-county-red/10 text-county-red" : "bg-black/5 text-black/60"}`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-black/70 font-mono">{log.resourceType}/{log.resourceId}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-black/40 py-8 text-xs">No audit records match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {cursor && !query && !actionFilter && (
        <div className="p-4 border-t border-black/5 text-center">
          <button type="button" onClick={loadMore} disabled={isPending} className="text-xs font-bold text-county-green hover:underline disabled:opacity-50">
            {isPending ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
