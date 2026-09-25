"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  setSessionCookie, clearSessionCookie, readSession,
  setMfaPendingCookie, readMfaPendingCookie, clearMfaPendingCookie,
} from "./session";
import { FeatureFlag, ApiClientIssuedSecret, CostSnapshot, ConfigHistoryEntry } from "./types";

// Same backend as the staff app — this console doesn't have its own user
// accounts, it authenticates against the same SUPERADMIN accounts and
// simply refuses anyone whose role isn't SUPERADMIN, checked here (not
// just hidden in the UI) since the backend itself has no concept of "this
// request came from the ops console."
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
// Control actions go to the control plane once it runs as its own process
// (Spec §3.1 Path A); falls back to the main API when unsplit.
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || BACKEND_URL;

function baseUrlFor(path: string): string {
  return path.startsWith("/api/control") ? CONTROL_PLANE_URL : BACKEND_URL;
}

async function apiWrite<T = any>(path: string, method: string, body?: any): Promise<T> {
  const session = readSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;

  const res = await fetch(`${baseUrlFor(path)}${path}`, {
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

    // A never-enrolled Superadmin still gets a session (matching auth.py's
    // behaviour), but middleware.ts now redirects them to the staff app's
    // enrollment flow before they can reach anything else in this console —
    // this is the most destructive surface in the whole system, so "opt-in"
    // MFA here specifically was the gap, not a deliberate choice.
    await setSessionCookie({
      userId: data.user.id, name: data.user.name, role: "SUPERADMIN", token: data.accessToken,
      mfaSetupRequired: !!data.mfaSetupRequired,
    });
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

    await setSessionCookie({
      userId: data.user.id, name: data.user.name, role: "SUPERADMIN", token: data.accessToken,
      mfaSetupRequired: !!data.mfaSetupRequired,
    });
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

export async function scheduleFeatureFlagAction(
  key: string,
  scheduledEnableAt: string | null,
  scheduledDisableAt: string | null,
): Promise<{ error?: string }> {
  try {
    await apiWrite<FeatureFlag>(`/api/feature-flags/${encodeURIComponent(key)}`, "PATCH", {
      scheduledEnableAt: scheduledEnableAt || null,
      scheduledDisableAt: scheduledDisableAt || null,
    });
  } catch (err: any) {
    return { error: err.message || "Could not schedule this flag." };
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

// --- Ops control plane actions (Ops Console Rebuild Spec §6) ---------------
// Each of these is fronted by <ActionButton>, which supplies the `reason`
// after showing the operator the action's blast radius and reversibility.
// The reason is not decoration: the backend records it in the audit trail
// so the entry explains intent, not just occurrence.

/** Shared shape so every panel handles failure identically. */
type ActionResult = { error?: string };

// --- Partner API client management (Critical tier — see lib/opsActions.ts) -

export interface CreateApiClientInput {
  name: string;
  saccoId?: string;
  scopes: string[];
  quotaTier: string;
  effectiveRole: string;
  environment: "sandbox" | "production";
  ipAllowlist: string[];
}

export async function createApiClientAction(
  input: CreateApiClientInput,
  reason: string,
  reauthToken?: string,
): Promise<{ issued?: ApiClientIssuedSecret; error?: string }> {
  try {
    const issued = await apiWrite<ApiClientIssuedSecret>("/api/control/api-clients", "POST", {
      name: input.name,
      sacco_id: input.saccoId || undefined,
      scopes: input.scopes,
      quota_tier: input.quotaTier,
      effective_role: input.effectiveRole,
      environment: input.environment,
      ip_allowlist: input.ipAllowlist,
      reason,
      reauth_token: reauthToken,
    });
    revalidatePath("/api-clients");
    return { issued };
  } catch (err: any) {
    return { error: err.message || "Could not issue this API client." };
  }
}

export async function revokeApiClientAction(clientId: string, reason: string, reauthToken?: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/api-clients/${encodeURIComponent(clientId)}/revoke`, "POST", { reason, reauth_token: reauthToken }),
    "Could not revoke this API client.",
    "/api-clients",
  );
}

export async function getApiClientUsageHistoryAction(clientId: string) {
  const { getApiClientUsageHistory } = await import("./data");
  return getApiClientUsageHistory(clientId);
}

async function runAction(fn: () => Promise<unknown>, fallback: string, revalidate = "/"): Promise<ActionResult> {
  try {
    await fn();
  } catch (err: any) {
    return { error: err.message || fallback };
  }
  revalidatePath(revalidate);
  return {};
}

export async function cancelJobAction(jobId: string, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/jobs/${encodeURIComponent(jobId)}/cancel`, "POST", { reason: reason || "Cancelled from ops console" }),
    "Could not cancel this job.",
    "/jobs",
  );
}

export async function retryAllFailedJobsAction(reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite("/api/control/jobs/retry-all-failed", "POST", { reason }),
    "Could not retry failed jobs.",
    "/jobs",
  );
}

export async function replayWebhookAction(logId: number, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/webhooks/${logId}/replay`, "POST", { reason: reason || "Replayed from ops console" }),
    "Could not replay this delivery.",
    "/integrations",
  );
}

export async function updateRateLimitAction(
  scope: string,
  limitValue: string | null,
  reason: string,
): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/rate-limits/${encodeURIComponent(scope)}`, "PATCH", { limit_value: limitValue, reason }),
    "Could not update this rate limit.",
    "/config",
  );
}

export async function overrideBreakerAction(name: string, override: string, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/circuit-breakers/${encodeURIComponent(name)}`, "POST", { override, reason }),
    "Could not override this circuit breaker.",
    "/integrations",
  );
}

export async function revokeSessionsAction(userId: string, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite("/api/control/sessions/revoke", "POST", { user_id: userId, reason }),
    "Could not revoke sessions.",
    "/sessions",
  );
}

export async function lockUserAction(userId: string, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/users/${encodeURIComponent(userId)}/lock`, "POST", { reason }),
    "Could not lock this account.",
    "/sessions",
  );
}

export async function unlockUserAction(userId: string, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/users/${encodeURIComponent(userId)}/unlock`, "POST", { reason }),
    "Could not unlock this account.",
    "/sessions",
  );
}

export async function resetMfaAction(userId: string, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/users/${encodeURIComponent(userId)}/reset-mfa`, "POST", { reason }),
    "Could not reset MFA for this account.",
    "/sessions",
  );
}

// --- Critical tier (Phase 5) ----------------------------------------------

/**
 * Step-up authentication for Critical actions.
 *
 * The password is exchanged for a short-lived token inside this Server
 * Action, so it is posted once to the control plane and never stored,
 * logged, or held in client state beyond the dialog that collected it.
 */
export async function reauthenticateAction(
  password: string,
  mfaCode?: string,
): Promise<{ reauthToken?: string; error?: string }> {
  const session = readSession();
  if (!session?.token) return { error: "Your session has expired. Sign in again." };

  // Deliberately does NOT go through apiWrite. That helper treats every 401
  // as "session expired" and calls redirect("/login") — correct for ordinary
  // calls, badly wrong here, where a 401 means "that password was wrong".
  // Routing re-auth through it both showed the operator a raw NEXT_REDIRECT
  // string instead of a real message, and would have signed them out for a
  // single typo in the middle of an incident.
  try {
    const res = await fetch(`${CONTROL_PLANE_URL}/api/control/reauth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ password, mfa_code: mfaCode }),
      cache: "no-store",
    });

    if (!res.ok) {
      let detail = "Could not confirm your identity.";
      try {
        detail = (await res.json()).detail || detail;
      } catch {}
      return { error: detail };
    }

    const data = await res.json();
    return { reauthToken: data.reauthToken };
  } catch {
    return { error: "Could not reach the control plane to confirm your identity." };
  }
}

export async function setMaintenanceModeAction(
  enabled: boolean,
  scope: string,
  message: string | null,
  reason: string,
  reauthToken?: string,
): Promise<ActionResult> {
  return runAction(
    () =>
      apiWrite("/api/control/maintenance-mode", "POST", {
        enabled,
        scope,
        message: message || undefined,
        reason,
        reauth_token: reauthToken,
      }),
    "Could not change maintenance mode.",
    "/config",
  );
}

export async function setMaintenanceAnnouncementAction(
  scheduledStart: string | null,
  scheduledEnd: string | null,
  message: string | null,
  reason: string,
): Promise<ActionResult> {
  return runAction(
    () =>
      apiWrite("/api/control/maintenance-announcement", "POST", {
        scheduled_start: scheduledStart || undefined,
        scheduled_end: scheduledEnd || undefined,
        message: message || undefined,
        reason,
      }),
    "Could not update the maintenance announcement.",
    "/config",
  );
}

export async function setKillSwitchAction(
  feature: string,
  killed: boolean,
  reason: string,
  reauthToken?: string,
): Promise<ActionResult> {
  return runAction(
    () =>
      apiWrite(`/api/control/kill-switch/${encodeURIComponent(feature)}`, "POST", {
        killed,
        reason,
        reauth_token: reauthToken,
      }),
    "Could not change this kill switch.",
    "/config",
  );
}

// --- Config history revert (Phase 5) ----------------------------------------
// Registered as Elevated, not the plan's originally-sketched Critical, on
// purpose: it re-submits through the same rate-limit/breaker/feature-flag
// endpoints a forward change already uses, and none of those require
// re-auth today. Marking this action Critical in opsActions.ts would mint
// and collect a reauth token this call never checks — the exact "UI
// promises a guardrail the backend doesn't enforce" bug already fixed once
// this session for API client create/revoke. If those endpoints later gain
// real re-auth, this should move to Critical alongside them.

export async function revertConfigEntryAction(entry: ConfigHistoryEntry, reason: string): Promise<ActionResult> {
  if (!entry.oldValues) {
    return { error: "No prior value recorded for this entry — nothing to revert to." };
  }

  if (entry.resourceType === "rate_limit") {
    return runAction(
      () => apiWrite(`/api/control/rate-limits/${encodeURIComponent(entry.resourceId)}`, "PATCH", {
        limit_value: entry.oldValues!.limitValue,
        reason,
      }),
      "Could not revert this rate limit.",
      "/config",
    );
  }

  if (entry.resourceType === "circuit_breaker") {
    return runAction(
      () => apiWrite(`/api/control/circuit-breakers/${encodeURIComponent(entry.resourceId)}`, "POST", {
        override: entry.oldValues!.override,
        reason,
      }),
      "Could not revert this circuit breaker.",
      "/config",
    );
  }

  if (entry.resourceType === "feature_flag") {
    return runAction(
      () => apiWrite(`/api/feature-flags/${encodeURIComponent(entry.resourceId)}`, "PATCH", {
        enabled: entry.oldValues!.enabled,
        description: entry.oldValues!.description,
      }),
      "Could not revert this feature flag.",
      "/config",
    );
  }

  return { error: `Reverting a ${entry.resourceType} entry isn't supported.` };
}

export async function getConfigHistoryAction(beforeId?: number) {
  const { getConfigHistory } = await import("./data");
  return getConfigHistory(beforeId);
}

// --- Cost dashboard (Phase 4, Elevated tier) --------------------------------

export async function recordCostSnapshotAction(
  month: string,
  amountKes: string,
  note: string,
  reason: string,
): Promise<ActionResult> {
  return runAction(
    () => apiWrite("/api/control/cost-snapshots", "POST", { month, amount_kes: amountKes, note: note || undefined, reason }),
    "Could not record this month's cost.",
    "/infrastructure",
  );
}

export async function getCostSnapshotsAction(): Promise<CostSnapshot[]> {
  const { getCostSnapshots } = await import("./data");
  return getCostSnapshots();
}

// --- Data retention review (Phase 6, Elevated tier) -------------------------
// Elevated, not Critical: the scan only ever counts and records, it never
// deletes a row (see app/retention.py's module docstring).

export async function scanRetentionNowAction(reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite("/api/control/retention/scan-now", "POST", { reason }),
    "Could not run the retention scan.",
    "/compliance",
  );
}

// --- Data-subject requests (Phase 6) -----------------------------------------

export interface CreateDsrInput {
  requestType: string;
  subjectName: string;
  subjectContact: string;
  description: string;
}

export async function createDsrAction(input: CreateDsrInput): Promise<ActionResult> {
  return runAction(
    () => apiWrite("/api/control/dsr", "POST", {
      request_type: input.requestType,
      subject_name: input.subjectName,
      subject_contact: input.subjectContact,
      description: input.description,
    }),
    "Could not record this request.",
    "/compliance",
  );
}

export async function updateDsrAction(id: number, status: string, resolutionNotes: string, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/dsr/${id}`, "PATCH", { status, resolution_notes: resolutionNotes || undefined, reason }),
    "Could not update this request.",
    "/compliance",
  );
}

// --- Data-quality checks (Phase 6, Elevated tier) ----------------------------

export async function scanDataQualityNowAction(reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite("/api/control/data-quality/scan-now", "POST", { reason }),
    "Could not run the data-quality scan.",
    "/compliance",
  );
}

// --- Two-person role-grant approval (Phase 7) --------------------------------

export async function approveRoleGrantAction(grantId: number, reason: string, reauthToken?: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/role-grants/${grantId}/approve`, "POST", { reason, reauth_token: reauthToken }),
    "Could not approve this role grant.",
    "/sessions",
  );
}

export async function rejectRoleGrantAction(grantId: number, reason: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite(`/api/control/role-grants/${grantId}/reject`, "POST", { reason }),
    "Could not reject this role grant.",
    "/sessions",
  );
}

// --- Backup restore test (Phase 6, Critical tier) ---------------------------

export async function triggerRestoreTestAction(reason: string, reauthToken?: string): Promise<ActionResult> {
  return runAction(
    () => apiWrite("/api/control/backup/test-restore", "POST", { reason, reauth_token: reauthToken }),
    "Could not run the restore test.",
    "/infrastructure",
  );
}

// --- Render deploy control (Phase 4, Critical tier) ------------------------

export async function triggerDeployAction(
  serviceId: string,
  reason: string,
  reauthToken?: string,
): Promise<{ deploy?: { id: string; status: string }; error?: string }> {
  try {
    const deploy = await apiWrite<{ id: string; status: string }>(
      `/api/control/render/${encodeURIComponent(serviceId)}/deploy`,
      "POST",
      { reason, reauth_token: reauthToken },
    );
    revalidatePath("/infrastructure");
    return { deploy };
  } catch (err: any) {
    return { error: err.message || "Could not trigger this deploy." };
  }
}

export async function rollbackDeployAction(
  serviceId: string,
  deployId: string,
  reason: string,
  reauthToken?: string,
): Promise<{ deploy?: { id: string; status: string }; error?: string }> {
  try {
    const deploy = await apiWrite<{ id: string; status: string }>(
      `/api/control/render/${encodeURIComponent(serviceId)}/rollback`,
      "POST",
      { deploy_id: deployId, reason, reauth_token: reauthToken },
    );
    revalidatePath("/infrastructure");
    return { deploy };
  } catch (err: any) {
    return { error: err.message || "Could not roll back this deploy." };
  }
}

export async function getRenderDeployHistoryAction(serviceId: string) {
  const { getRenderDeployHistory } = await import("./render");
  return getRenderDeployHistory(serviceId);
}

export async function revokeAllSessionsAction(
  reason: string,
  reauthToken?: string,
): Promise<ActionResult> {
  // Deliberately no revalidatePath: this revokes the operator's own session
  // too, so the next request will fail auth and redirect to /login. Trying
  // to re-render the current page first would just surface a confusing
  // error before the redirect.
  try {
    await apiWrite("/api/control/sessions/revoke-all", "POST", { reason, reauth_token: reauthToken });
  } catch (err: any) {
    return { error: err.message || "Could not revoke all sessions." };
  }
  return {};
}
