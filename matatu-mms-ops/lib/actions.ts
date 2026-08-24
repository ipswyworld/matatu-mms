"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  setSessionCookie, clearSessionCookie, readSession,
  setMfaPendingCookie, readMfaPendingCookie, clearMfaPendingCookie,
} from "./session";
import { FeatureFlag } from "./types";

// Same backend as the staff app — this console doesn't have its own user
// accounts, it authenticates against the same SUPERADMIN accounts and
// simply refuses anyone whose role isn't SUPERADMIN, checked here (not
// just hidden in the UI) since the backend itself has no concept of "this
// request came from the ops console."
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

async function apiWrite<T = any>(path: string, method: string, body?: any): Promise<T> {
  const session = readSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 401) redirect("/login");
    const text = await res.text();
    let msg = "Action failed";
    try { msg = JSON.parse(text).detail || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export async function loginAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 401) return { error: "Invalid email or password." };
      if (res.status === 429) return { error: "Too many sign-in attempts. Please wait a minute and try again." };
      return { error: `Sign-in failed (${res.status}). Please try again.` };
    }

    const data = await res.json();

    if (data.mfaRequired) {
      setMfaPendingCookie(data.mfaToken);
      redirect("/mfa-verify");
    }

    if (data.user.role !== "SUPERADMIN") {
      return { error: "This console is for Superadmin accounts only." };
    }

    // MFA is opt-in, not required, to reach this console — a Superadmin who
    // hasn't enrolled just signs straight in. Anyone who does enable MFA
    // (via the staff app) still goes through the mfaRequired branch above
    // on their next login, same as any other account.
    await setSessionCookie({ userId: data.user.id, name: data.user.name, role: "SUPERADMIN", token: data.accessToken });
    redirect("/");
  } catch (err: any) {
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw err;
    return { error: "Could not reach the authentication server. Please check your connection and try again." };
  }
}

export async function verifyMfaAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const code = String(formData.get("code") || "").trim();
  const mfaToken = readMfaPendingCookie();

  if (!mfaToken) {
    return { error: "This sign-in attempt has expired. Please sign in again." };
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/verify-mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, code }),
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 401) return { error: "That code is incorrect. Please try again." };
      return { error: `Verification failed (${res.status}). Please try again.` };
    }

    const data = await res.json();
    clearMfaPendingCookie();

    if (data.user.role !== "SUPERADMIN") {
      return { error: "This console is for Superadmin accounts only." };
    }

    await setSessionCookie({ userId: data.user.id, name: data.user.name, role: "SUPERADMIN", token: data.accessToken });
    redirect("/");
  } catch (err: any) {
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw err;
    return { error: "Could not reach the authentication server. Please check your connection and try again." };
  }
}

export async function logoutAction() {
  clearSessionCookie();
  redirect("/login");
}

// "Load more" for AuditLogViewer (a client component, so it can't call
// lib/data.ts's server-only getAuditLogsPage directly) — thin re-export as
// a Server Action.
export async function loadMoreAuditLogsAction(beforeId: number) {
  const { getAuditLogsPage } = await import("./data");
  return getAuditLogsPage(beforeId);
}

// Tier-1 config CRUD (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md A.2) — the
// guardrail pattern built here (RBAC via the backend's manage_system_config
// permission, every write audit-logged server-side, confirm-before-delete
// in the UI) is meant to be reused for the next Tier-1 CRUD surface, not
// re-invented per feature.
export async function createFeatureFlagAction(
  _prevState: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const key = String(formData.get("key") || "").trim();
  const description = String(formData.get("description") || "").trim();
  try {
    await apiWrite<FeatureFlag>("/api/feature-flags", "POST", { key, description: description || undefined, enabled: false });
  } catch (err: any) {
    return { error: err.message || "Could not create flag." };
  }
  revalidatePath("/");
  return {};
}

export async function toggleFeatureFlagAction(key: string, enabled: boolean): Promise<{ error?: string }> {
  try {
    await apiWrite<FeatureFlag>(`/api/feature-flags/${encodeURIComponent(key)}`, "PATCH", { enabled });
  } catch (err: any) {
    return { error: err.message || "Could not update flag." };
  }
  revalidatePath("/");
  return {};
}

export async function deleteFeatureFlagAction(key: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/feature-flags/${encodeURIComponent(key)}`, "DELETE");
  } catch (err: any) {
    return { error: err.message || "Could not delete flag." };
  }
  revalidatePath("/");
  return {};
}

export async function retryJobAction(jobId: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/jobs/queue/${encodeURIComponent(jobId)}/retry`, "POST");
  } catch (err: any) {
    return { error: err.message || "Could not retry this job." };
  }
  revalidatePath("/");
  return {};
}

// Ops console and staff app are separate origins — a cookie set here isn't
// visible there. This mints a short-lived, single-use ticket and redirects
// the browser to the staff app, which exchanges it for a real session
// server-side (see /impersonate/consume there). Never the actual bearer
// token itself crosses this redirect.
const STAFF_APP_URL = process.env.STAFF_APP_URL || "http://localhost:3000";

// Returns the URL rather than calling redirect() itself: next/navigation's
// redirect() throws a special error that Next's client runtime is meant to
// turn into a real top-level navigation, but that only reliably happens for
// actions invoked via a <form action={...}> submission. This action is
// invoked from a plain button's onClick (via startTransition, see
// ImpersonationPanel.tsx) so it can show inline confirm/cancel state first —
// and in that shape, a redirect() to a cross-origin URL was observed to be
// swallowed by the action's own internal fetch (which follows redirects as
// part of resolving the request) instead of navigating the browser tab,
// leaving the button stuck on "Starting…" forever. Handing the URL back and
// letting the client do `window.location.href = url` sidesteps that
// entirely — it's a real browser navigation no matter how it was triggered.
export async function startImpersonationAction(userId: string): Promise<{ url?: string; error?: string }> {
  let ticket: string;
  try {
    const result = await apiWrite<{ ticket: string }>(`/api/auth/impersonate/${encodeURIComponent(userId)}`, "POST");
    ticket = result.ticket;
  } catch (err: any) {
    return { error: err.message || "Could not start impersonation." };
  }
  return { url: `${STAFF_APP_URL}/impersonate/consume?ticket=${encodeURIComponent(ticket)}` };
}
