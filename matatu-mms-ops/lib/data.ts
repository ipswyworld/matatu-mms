import { redirect } from "next/navigation";
import { readSession } from "./session";
import { SystemHealth, AuditLog, StaffUser, FeatureFlag } from "./types";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const AUDIT_LOG_PAGE_SIZE = 50;

async function apiFetch<T>(path: string): Promise<T> {
  const session = readSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, { headers, cache: "no-store" });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) redirect("/login");
    const text = await res.text();
    let msg = `Request to ${path} failed with status ${res.status}`;
    try { msg = JSON.parse(text).detail || msg; } catch {}
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  return apiFetch<SystemHealth>("/api/system/health");
}

// The audit log viewer (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md A.5 #2) —
// embedded here rather than just linking out to the staff app's
// /audit-logs page, per that doc's explicit instruction. Same endpoint the
// staff app's own (unlinked-from-nav) audit page reads, same keyset
// pagination (before_id, not offset — see audit_logs.py's own docstring
// for why offset doesn't scale here).
export async function getAuditLogsPage(beforeId?: number): Promise<{ logs: AuditLog[]; nextCursor: number | null }> {
  const qs = beforeId ? `?limit=${AUDIT_LOG_PAGE_SIZE}&before_id=${beforeId}` : `?limit=${AUDIT_LOG_PAGE_SIZE}`;
  const logs = await apiFetch<AuditLog[]>(`/api/audit-logs${qs}`);
  const nextCursor = logs.length === AUDIT_LOG_PAGE_SIZE ? logs[logs.length - 1].id : null;
  return { logs, nextCursor };
}

// id->name lookup for the audit viewer's "performed by" column — AuditLog
// only carries user_id, same convention the staff app's own AuditLogTable
// uses (join client-side against the user list, since that's already a
// single cheap fetch this account has permission for).
export async function getStaffUsers(): Promise<StaffUser[]> {
  const users = await apiFetch<Array<{ id: string; name: string }>>("/api/users");
  return users.map((u) => ({ id: u.id, name: u.name }));
}

export async function getFeatureFlags(): Promise<FeatureFlag[]> {
  return apiFetch<FeatureFlag[]>("/api/feature-flags");
}
