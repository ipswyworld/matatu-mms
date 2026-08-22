import { redirect } from "next/navigation";
import { readSession } from "./session";
import { SystemHealth } from "./types";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

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
