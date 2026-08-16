"use client";

import { useState } from "react";
import { AuditLog } from "@/lib/types";
import ExportCsvButton from "./ExportCsvButton";

interface Row {
  log: AuditLog;
  userName: string;
  resourceLabel: string;
}

function formatChanges(log: AuditLog) {
  try {
    const oldVal = log.oldValues ? JSON.parse(log.oldValues) : null;
    const newVal = log.newValues ? JSON.parse(log.newValues) : null;

    if (log.action === "STATUS_CHANGE") {
      const field = oldVal && "status" in oldVal ? "status" : "state";
      return (
        <span className="text-xs">
          Changed <span className="font-semibold">{field}</span> from{" "}
          <span className="badge bg-black/5 text-black/60">{oldVal?.[field]}</span> to{" "}
          <span className="badge bg-county-green/10 text-county-green">{newVal?.[field]}</span>
        </span>
      );
    }

    if (log.action === "CREATE") {
      if (log.resourceType === "fine") {
        return (
          <span className="text-xs text-black/60">
            Issued fine of <span className="font-semibold text-black">KES {newVal?.amountKes?.toLocaleString()}</span> for{" "}
            <span className="italic">&quot;{newVal?.reason}&quot;</span>
          </span>
        );
      }
      return <span className="text-xs text-black/40">Record created</span>;
    }
  } catch {}
  return <span className="text-xs text-black/40">—</span>;
}

function plainChangeSummary(log: AuditLog): string {
  try {
    const oldVal = log.oldValues ? JSON.parse(log.oldValues) : null;
    const newVal = log.newValues ? JSON.parse(log.newValues) : null;
    if (log.action === "STATUS_CHANGE") {
      const field = oldVal && "status" in oldVal ? "status" : "state";
      return `${field} ${oldVal?.[field]} -> ${newVal?.[field]}`;
    }
    if (log.action === "CREATE" && log.resourceType === "fine") {
      return `Issued fine KES ${newVal?.amountKes} for "${newVal?.reason}"`;
    }
  } catch {}
  return "";
}

export default function AuditLogTable({ rows }: { rows: Row[] }) {
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const actions = Array.from(new Set(rows.map((r) => r.log.action)));

  const filtered = rows.filter(({ log, userName, resourceLabel }) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q || userName.toLowerCase().includes(q) || resourceLabel.toLowerCase().includes(q);
    const matchesAction = !actionFilter || log.action === actionFilter;
    return matchesQuery && matchesAction;
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap gap-3 items-center p-4 border-b border-county-ink/[0.06]">
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
        <span className="text-xs font-bold text-county-ink/50">
          {filtered.length} of {rows.length}
        </span>
        <ExportCsvButton
          variant="light"
          filename="audit-trail"
          headers={["Timestamp", "User", "Action", "Resource", "Change"]}
          rows={filtered.map(({ log, userName, resourceLabel }) => [
            new Date(log.timestamp).toLocaleString(),
            userName,
            log.action,
            resourceLabel,
            plainChangeSummary(log),
          ])}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Change Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ log, userName, resourceLabel }) => (
              <tr key={log.id}>
                <td className="text-xs text-black/50">{new Date(log.timestamp).toLocaleString()}</td>
                <td className="font-semibold text-xs">{userName}</td>
                <td>
                  <span className={`badge text-xs font-semibold ${
                    log.action === "CREATE" ? "bg-county-green/10 text-county-green" : "bg-black/5 text-black/60"
                  }`}>
                    {log.action}
                  </span>
                </td>
                <td className="text-xs text-black/70 font-mono">{resourceLabel}</td>
                <td>{formatChanges(log)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-black/40 py-8">
                  No audit records match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
