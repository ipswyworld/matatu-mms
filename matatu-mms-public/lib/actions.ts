"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSessionCookie, readSession, setSessionCookie } from "./session";
import { getReports } from "./data";
import { Booking, MatatuStatus, PassengerReport, ReportStatus, Role, SaccoDocType } from "./types";

// Server-side calls (Server Actions run in Node, not the browser) —
// overridable so docker-compose can point this at the internal service
// name ("http://backend:8000") instead of localhost.
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

/**
 * Helper to perform write operations against the Python API.
 */
async function apiWrite<T = any>(path: string, method: string, body?: any): Promise<T> {
  const session = readSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 401) {
      redirect("/login");
    }
    const errorText = await res.text();
    let errorMessage = "Action failed";
    try {
      errorMessage = JSON.parse(errorText).detail || errorMessage;
    } catch {}
    throw new Error(errorMessage);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }
  return res.json() as Promise<T>;
}

// The access token embedded in the session cookie expires after 60
// minutes (backend's ACCESS_TOKEN_EXPIRE_MINUTES), but the cookie itself
// lasts 8 hours (30 days with "remember me" — those tokens already get a
// matching long expiry up front and never hit this path). Without this,
// every fetch and every open WebSocket (NotificationBell) would silently
// start failing an hour into any normal session while the UI still looks
// logged in. Called proactively by NotificationBell before its token
// would expire, and safe to call after it already has (the backend
// tolerates a recently-expired token here, not just a valid one).
export async function refreshSessionAction(): Promise<{ accessToken?: string; error?: string }> {
  const session = readSession();
  if (!session?.token) return { error: "No session to refresh." };

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = "Could not refresh session.";
      try {
        msg = (await res.json()).detail || msg;
      } catch {}
      return { error: msg };
    }
    const data = await res.json();
    // Re-applying session.rememberMe as the maxAge argument matters:
    // without it, a remember-me user's 30-day cookie would quietly shrink
    // to the default 8 hours on the very first background refresh.
    await setSessionCookie({ ...session, token: data.accessToken }, session.rememberMe);
    return { accessToken: data.accessToken };
  } catch {
    return { error: "Could not reach the authentication server." };
  }
}

export async function loginAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const rememberMe = formData.get("rememberMe") === "on";
  const turnstileToken = formData.get("cf-turnstile-response");

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email, password, remember_me: rememberMe,
        turnstile_token: turnstileToken ? String(turnstileToken) : undefined,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      // A non-2xx response was previously always shown as "Invalid email
      // or password" regardless of cause — including a 502/503 while the
      // backend is cold-starting (Render's free tier spins services down
      // after inactivity) or a 429 from the login rate limiter, both of
      // which are not the user's fault and look nothing like a wrong
      // password. Distinguish by status so the message actually matches
      // what happened.
      if (res.status === 401) {
        return { error: "Invalid login details or password." };
      }
      if (res.status === 429) {
        return { error: "Too many sign-in attempts. Please wait a minute and try again." };
      }
      if (res.status >= 500 || res.status === 502 || res.status === 503) {
        return { error: "The system is starting up — this can take up to a minute on first use. Please try again shortly." };
      }
      let detail: string | undefined;
      try {
        detail = (await res.json()).detail;
      } catch {}
      return { error: detail || `Sign-in failed (${res.status}). Please try again.` };
    }

    const data = await res.json();
    const userRole = data.user.role as Role;
    await setSessionCookie(
      {
        userId: data.user.id,
        name: data.user.name,
        role: userRole,
        saccoId: data.user.saccoId,
        token: data.accessToken,
        rememberMe,
      },
      rememberMe
    );

    if (userRole === "PASSENGER") {
      redirect("/passenger-portal");
    } else if (userRole === "CREW") {
      redirect("/crew-portal");
    } else if (userRole === "SACCO_OPERATOR") {
      redirect("/sacco-portal");
    } else if (
      userRole === "ENFORCEMENT" ||
      userRole === "ARRESTING_OFFICER" ||
      userRole === "RELEASING_OFFICER" ||
      userRole === "ENFORCEMENT_COMMANDER"
    ) {
      redirect("/enforcement");
    } else {
      redirect("/dashboard");
    }
  } catch (err: any) {
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw err;
    // fetch() itself throwing (as opposed to resolving with a non-2xx
    // response) means the request never completed — a real network/
    // connectivity failure, or the backend timing out entirely during a
    // cold start. Same honesty principle as above: don't call this a
    // wrong password.
    return { error: "Could not reach the authentication server. Please check your connection and try again." };
  }
}

export async function registerAction(_prevState: { error?: string; pendingGuardianApproval?: string } | undefined, formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim() || undefined;
  const phone = String(formData.get("phone") || "").trim() || undefined;
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "PASSENGER") as Role;
  const saccoId = String(formData.get("saccoId") || "").trim() || undefined;
  const signature = String(formData.get("signature") || "").trim();
  const isMinor = formData.get("isMinor") === "true";
  const guardianName = String(formData.get("guardianName") || "").trim() || undefined;
  const guardianPhone = String(formData.get("guardianPhone") || "").trim() || undefined;
  const guardianRelationship = String(formData.get("guardianRelationship") || "").trim() || undefined;
  const guardianIdNumber = String(formData.get("guardianIdNumber") || "").trim() || undefined;
  const turnstileToken = formData.get("cf-turnstile-response");

  if (role === "PASSENGER" && !phone) {
    return { error: "A phone number is required to register." };
  }
  if (isMinor && !(guardianName && guardianPhone && guardianRelationship && guardianIdNumber)) {
    return { error: "Guardian name, phone, relationship, and ID number are all required for a student/minor account." };
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        phone,
        password,
        role,
        saccoId,
        termsAccepted: true,
        termsSignature: signature,
        isMinor,
        guardianName,
        guardianPhone,
        guardianRelationship,
        guardianIdNumber,
        turnstileToken: turnstileToken ? String(turnstileToken) : undefined,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = "Registration failed.";
      try { msg = JSON.parse(errText).detail || msg; } catch {}
      return { error: msg };
    }

    const data = await res.json();

    if (data.pendingGuardianApproval) {
      // A minor's account isn't logged in on registration — no token, no
      // session cookie to set (see register()'s backend comment). Surface
      // the "check your guardian's SMS" message on the same form instead
      // of redirecting anywhere, since there's nowhere to redirect to yet.
      return { pendingGuardianApproval: data.message as string };
    }

    const userRole = data.user.role as Role;
    await setSessionCookie({
      userId: data.user.id,
      name: data.user.name,
      role: userRole,
      saccoId: data.user.saccoId,
      token: data.accessToken,
    });

    if (userRole === "PASSENGER") {
      redirect("/passenger-portal");
    } else if (userRole === "CREW") {
      redirect("/crew-portal");
    } else if (userRole === "SACCO_OPERATOR") {
      redirect("/sacco-portal");
    } else {
      redirect("/dashboard");
    }
  } catch (err: any) {
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw err;
    return { error: err.message || "Registration failed." };
  }
}

/**
 * Unauthenticated Sacco list for the pre-login registration page's Crew
 * "Assigned Operator" picker. Hits the public backend endpoint (id + name
 * only) since the visitor has no session/token yet to call GET /api/saccos.
 */
export async function getPublicSaccosAction(): Promise<{ id: string; name: string }[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/saccos/public`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function operatorOnboardingRegisterAction(
  _prevState: { error?: string } | undefined,
  formData: FormData
) {
  const saccoName = String(formData.get("saccoName") || "").trim();
  const saccoType = String(formData.get("saccoType") || "EXISTING");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const signature = String(formData.get("signature") || "").trim();

  try {
    const res = await fetch(`${BACKEND_URL}/api/saccos/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        saccoName,
        saccoType,
        name,
        email,
        password,
        termsAccepted: true,
        termsSignature: signature,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = "Onboarding registration failed.";
      try { msg = JSON.parse(errText).detail || msg; } catch {}
      return { error: msg };
    }

    const data = await res.json();
    await setSessionCookie({
      userId: data.user.id,
      name: data.user.name,
      role: "SACCO_OPERATOR",
      saccoId: data.user.saccoId,
      token: data.accessToken,
    });
  } catch (err: any) {
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw err;
    return { error: err.message || "Onboarding registration failed." };
  }

  redirect("/operator-onboarding/continue");
}

async function apiWriteMultipart(path: string, formData: FormData): Promise<any> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (session?.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers,
    body: formData,
    cache: "no-store",
  });
  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = "Upload failed";
    try { errorMessage = JSON.parse(errorText).detail || errorMessage; } catch {}
    throw new Error(errorMessage);
  }
  return res.json();
}

export async function uploadSaccoDocumentAction(
  saccoId: string,
  docType: SaccoDocType,
  formData: FormData
): Promise<{ error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please choose a file to upload." };
  }
  const upload = new FormData();
  upload.set("doc_type", docType);
  upload.set("file", file);
  try {
    await apiWriteMultipart(`/api/saccos/${saccoId}/documents`, upload);
  } catch (err: any) {
    return { error: err.message || "Upload failed." };
  }
  revalidatePath("/sacco-portal");
  revalidatePath("/saccos/verify");
  return {};
}

export async function uploadFareChartAction(
  routeId: string,
  formData: FormData
): Promise<{ error?: string; created?: number; unmatched?: number; total?: number }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please choose a PDF fare chart to upload." };
  }
  const upload = new FormData();
  upload.set("file", file);
  try {
    const result = await apiWriteMultipart(`/api/routes/${routeId}/fare-stages/upload`, upload);
    revalidatePath("/sacco-portal");
    return { created: result.created?.length ?? 0, unmatched: result.unmatchedRows ?? 0, total: result.totalRows ?? 0 };
  } catch (err: any) {
    return { error: err.message || "Upload failed." };
  }
}

export async function updateSaccoOfficialsAction(
  saccoId: string,
  _prevState: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const chairpersonName = String(formData.get("chairpersonName") || "").trim();
  const chairpersonPhone = String(formData.get("chairpersonPhone") || "").trim();
  const secretaryName = String(formData.get("secretaryName") || "").trim();
  const secretaryPhone = String(formData.get("secretaryPhone") || "").trim();
  const treasurerName = String(formData.get("treasurerName") || "").trim();
  const treasurerPhone = String(formData.get("treasurerPhone") || "").trim();

  if (!chairpersonName || !chairpersonPhone || !secretaryName || !secretaryPhone || !treasurerName || !treasurerPhone) {
    return { error: "All bonafide official contacts are required." };
  }

  try {
    await apiWrite(`/api/saccos/${saccoId}/officials`, "PATCH", {
      chairpersonName,
      chairpersonPhone,
      secretaryName,
      secretaryPhone,
      treasurerName,
      treasurerPhone,
    });
  } catch (err: any) {
    return { error: err.message || "Could not save officials." };
  }
  revalidatePath("/sacco-portal");
  revalidatePath("/saccos/verify");
  return {};
}

export async function submitApplicationAction(saccoId: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/saccos/${saccoId}/submit-application`, "POST");
  } catch (err: any) {
    return { error: err.message || "Could not submit your application." };
  }
  revalidatePath("/operator-onboarding/continue");
  revalidatePath("/sacco-portal");
  revalidatePath("/saccos/verify");
  return {};
}

export async function decideDirectorStageAction(
  saccoId: string,
  decisionStatus: "APPROVED" | "REJECTED",
  reason?: string
): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/saccos/${saccoId}/verification/director`, "PATCH", { status: decisionStatus, reason });
  } catch (err: any) {
    return { error: err.message || "Could not record decision." };
  }
  revalidatePath("/saccos/verify");
  revalidatePath("/sacco-portal");
  revalidatePath("/dashboard");
  return {};
}

export async function decideChiefOfficerStageAction(
  saccoId: string,
  decisionStatus: "APPROVED" | "REJECTED",
  reason?: string
): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/saccos/${saccoId}/verification/chief-officer`, "PATCH", { status: decisionStatus, reason });
  } catch (err: any) {
    return { error: err.message || "Could not record decision." };
  }
  revalidatePath("/saccos/verify");
  revalidatePath("/sacco-portal");
  revalidatePath("/dashboard");
  return {};
}

export async function fileEnforcementCaseAction(formData: FormData): Promise<{ error?: string; caseReference?: string }> {
  const regNumber = String(formData.get("regNumber") || "").trim();
  const offenceTypeId = String(formData.get("offenceTypeId") || "").trim();
  const offenceDescription = String(formData.get("offenceDescription") || "").trim();
  const actionTaken = String(formData.get("actionTaken") || "").trim();
  const photos = formData.getAll("photos").filter((f) => f instanceof File && f.size > 0) as File[];

  if (!regNumber || !offenceTypeId || !actionTaken) {
    return { error: "Plate number, offence, and action taken are all required." };
  }

  const upload = new FormData();
  upload.set("reg_number", regNumber);
  upload.set("offence_type_id", offenceTypeId);
  upload.set("offence_description", offenceDescription);
  upload.set("action_taken", actionTaken);
  photos.forEach((f) => upload.append("photos", f));

  try {
    const result = await apiWriteMultipart("/api/enforcement/cases", upload);
    revalidatePath("/enforcement/cases");
    revalidatePath("/enforcement");
    return { caseReference: result.caseReference };
  } catch (err: any) {
    return { error: err.message || "Could not file the case." };
  }
}

export async function releaseEnforcementCaseAction(caseId: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/enforcement/cases/${caseId}/release`, "PATCH");
  } catch (err: any) {
    return { error: err.message || "Could not release this case." };
  }
  revalidatePath("/enforcement/cases");
  revalidatePath("/enforcement");
  return {};
}

export async function disputeEnforcementCaseAction(caseId: string, reason: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/enforcement/cases/${caseId}/dispute`, "PATCH", { reason });
  } catch (err: any) {
    return { error: err.message || "Could not mark this case disputed." };
  }
  revalidatePath("/enforcement/cases");
  revalidatePath("/enforcement");
  return {};
}

export async function waiveEnforcementCaseAction(caseId: string, reason: string, authorizedBy: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/enforcement/cases/${caseId}/waive`, "PATCH", { reason, authorizedBy });
  } catch (err: any) {
    return { error: err.message || "Could not waive this case." };
  }
  revalidatePath("/enforcement/cases");
  revalidatePath("/enforcement");
  return {};
}

export async function updateOfficerAssignmentAction(
  userId: string,
  update: { enforcementDuty?: string | null; assignedZoneId?: string | null; commanderTitle?: string | null }
): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/enforcement/officer-assignments/${userId}`, "PATCH", update);
  } catch (err: any) {
    return { error: err.message || "Could not update officer assignment." };
  }
  revalidatePath("/enforcement/command");
  return {};
}

const PUBLIC_BACKEND_URL = BACKEND_URL;

// Accepts either a case reference (MMS-...) or a phone number in the same
// field — the point of this being one box instead of two is that the
// person looking themselves up doesn't need to know or care which kind of
// value they're holding. "Looks like a phone" is deliberately generous
// (digits/+/spaces/dashes, at least 7 digits) rather than requiring a
// specific format, since it only decides which backend route to call —
// picking wrong just produces the normal "not found" error, not a crash.
function looksLikePhone(value: string): boolean {
  const digitCount = (value.match(/\d/g) || []).length;
  return digitCount >= 7 && /^[+\d\s-]+$/.test(value);
}

export async function publicLookupCaseAction(query: string): Promise<{ error?: string; caseData?: any }> {
  const trimmed = query.trim();
  const isPhone = !trimmed.toUpperCase().startsWith("MMS") && looksLikePhone(trimmed);
  const url = isPhone
    ? `${PUBLIC_BACKEND_URL}/api/enforcement/cases/public/lookup-by-phone?phone=${encodeURIComponent(trimmed)}`
    : `${PUBLIC_BACKEND_URL}/api/enforcement/cases/public/${encodeURIComponent(trimmed)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const errText = await res.text();
      let msg = isPhone ? "No cases found for that phone number." : "Case not found.";
      try { msg = JSON.parse(errText).detail || msg; } catch {}
      return { error: msg };
    }
    return { caseData: await res.json() };
  } catch (err: any) {
    return { error: err.message || "Could not look up this case." };
  }
}

export async function publicPayCaseAction(caseReference: string): Promise<{ error?: string; caseData?: any }> {
  try {
    const res = await fetch(`${PUBLIC_BACKEND_URL}/api/enforcement/cases/public/${encodeURIComponent(caseReference.trim())}/pay`, {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok) {
      const errText = await res.text();
      let msg = "Payment failed.";
      try { msg = JSON.parse(errText).detail || msg; } catch {}
      return { error: msg };
    }
    return { caseData: await res.json() };
  } catch (err: any) {
    return { error: err.message || "Payment failed." };
  }
}

export async function publicDisputeCaseAction(
  caseReference: string,
  reason: string,
  contactPhone: string
): Promise<{ error?: string; caseData?: any }> {
  try {
    const res = await fetch(`${PUBLIC_BACKEND_URL}/api/enforcement/cases/public/${encodeURIComponent(caseReference.trim())}/dispute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, contactPhone: contactPhone || undefined }),
      cache: "no-store",
    });
    if (!res.ok) {
      const errText = await res.text();
      let msg = "Could not submit your dispute.";
      try { msg = JSON.parse(errText).detail || msg; } catch {}
      return { error: msg };
    }
    return { caseData: await res.json() };
  } catch (err: any) {
    return { error: err.message || "Could not submit your dispute." };
  }
}

export async function logoutAction() {
  try {
    await apiWrite("/api/auth/logout", "POST");
  } catch {}
  clearSessionCookie();
  redirect("/login");
}

export async function addMatatuAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const regNumber = String(formData.get("regNumber") || "").trim().toUpperCase();
  const saccoId = String(formData.get("saccoId") || "");
  const routeId = String(formData.get("routeId") || "");
  const terminalSegment = String(formData.get("terminalSegment") || "").trim();
  const capacity = Number(formData.get("capacity") || 0);

  if (!regNumber || !saccoId || !routeId || !capacity) {
    return { error: "All fields are required." };
  }

  try {
    await apiWrite("/api/matatus", "POST", {
      regNumber,
      saccoId,
      routeId,
      terminalSegment: terminalSegment || "CBD Central Terminal: Main Stage",
      capacity,
      status: "ACTIVE",
    });
  } catch (err: any) {
    return { error: err.message };
  }

  revalidatePath("/matatus");
  redirect("/matatus");
}

export async function addRouteAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();

  if (!code || !name) {
    return { error: "Route code and name are required." };
  }

  const id = `route-${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

  try {
    // Fare is set separately (per-route, once operators have real corridor
    // data) rather than guessed at creation time — backend applies a
    // placeholder default until it's set.
    await apiWrite("/api/routes", "POST", { id, code, name, description });
  } catch (err: any) {
    return { error: err.message };
  }

  revalidatePath("/routes");
  redirect("/routes");
}

export async function onboardSaccoVehicleAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const session = readSession();
  const regNumber = String(formData.get("regNumber") || "").trim().toUpperCase();
  const saccoId = session?.saccoId || String(formData.get("saccoId") || "sacco-1");
  const routeId = String(formData.get("routeId") || "route-1");
  const terminalSegment = String(formData.get("terminalSegment") || "").trim();
  const capacity = Number(formData.get("capacity") || 14);
  const driverName = String(formData.get("driverName") || "").trim();
  const driverLicense = String(formData.get("driverLicense") || "").trim();
  const driverPhone = String(formData.get("driverPhone") || "").trim();
  const conductorName = String(formData.get("conductorName") || "").trim();
  const conductorLicense = String(formData.get("conductorLicense") || "").trim();
  const conductorPhone = String(formData.get("conductorPhone") || "").trim();

  if (!regNumber || !routeId || !capacity) {
    return { error: "Vehicle plate number, route, and capacity are required." };
  }
  if (!driverName || !driverLicense || !driverPhone) {
    return { error: "Driver name, driving license, and contact are required." };
  }
  if (!conductorName || !conductorLicense || !conductorPhone) {
    return { error: "Conductor name, driving license, and contact are required." };
  }

  try {
    await apiWrite("/api/matatus", "POST", {
      regNumber,
      saccoId,
      routeId,
      terminalSegment: terminalSegment || "CBD-Umoja Terminal: Tusker Stage",
      capacity,
      status: "REGISTRATION_PENDING",
      driverName,
      driverLicense,
      driverPhone,
      conductorName,
      conductorLicense,
      conductorPhone,
    });
  } catch (err: any) {
    return { error: err.message };
  }

  revalidatePath("/sacco-portal");
  revalidatePath("/matatus");
  redirect("/sacco-portal");
}

export async function bulkImportVehiclesAction(formData: FormData): Promise<{
  error?: string;
  created?: number;
  errors?: { row: number; regNumber?: string; missingFields: string[]; message: string }[];
  totalRows?: number;
}> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please choose a CSV, Excel, or PDF file to upload." };
  }
  const upload = new FormData();
  upload.set("file", file);

  const session = readSession();
  const headers: Record<string, string> = {};
  if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;

  try {
    const res = await fetch(`${BACKEND_URL}/api/matatus/bulk-import`, {
      method: "POST",
      headers,
      body: upload,
      cache: "no-store",
    });
    if (!res.ok) {
      const errText = await res.text();
      let msg = "Bulk import failed.";
      try { msg = JSON.parse(errText).detail || msg; } catch {}
      return { error: msg };
    }
    const data = await res.json();
    revalidatePath("/sacco-portal");
    revalidatePath("/matatus");
    return {
      created: data.created?.length || 0,
      errors: (data.errors || []).map((e: any) => ({
        row: e.row,
        regNumber: e.regNumber,
        missingFields: e.missingFields || [],
        message: e.message,
      })),
      totalRows: data.totalRows,
    };
  } catch (err: any) {
    return { error: err.message || "Bulk import failed." };
  }
}

export async function removeMatatuAction(matatuId: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/matatus/${matatuId}`, "DELETE");
  } catch (err: any) {
    return { error: err.message || "Could not remove vehicle." };
  }
  revalidatePath("/sacco-portal");
  revalidatePath("/matatus");
  return {};
}

export async function recordCrimeAction(_prevState: { error?: string } | undefined, formData: FormData) {
  let offenceCommitted = String(formData.get("offenceCommitted") || "").trim();
  const offenceOtherText = String(formData.get("offenceOtherText") || "").trim();
  const regNumber = String(formData.get("regNumber") || "").trim().toUpperCase();
  const driverName = String(formData.get("driverName") || "").trim();
  const driverLicense = String(formData.get("driverLicense") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const fineAmountKes = Number(formData.get("fineAmountKes") || 0);
  const remarks = String(formData.get("remarks") || "").trim();
  const photo = formData.get("photo");

  if (offenceCommitted === "Other") {
    if (!offenceOtherText) {
      return { error: "Please describe the offence." };
    }
    offenceCommitted = `Other: ${offenceOtherText}`;
  }

  if (!offenceCommitted || offenceCommitted === "Select" || !regNumber || !location) {
    return { error: "Offence committed, plate number, and location are required." };
  }
  if (!(photo instanceof File) || photo.size === 0) {
    return { error: "Photo evidence is required." };
  }

  const upload = new FormData();
  upload.set("offence_committed", offenceCommitted);
  upload.set("reg_number", regNumber);
  upload.set("driver_name", driverName || "Unidentified Driver");
  upload.set("driver_license", driverLicense || "N/A");
  upload.set("location", location);
  upload.set("fine_amount_kes", String(fineAmountKes));
  upload.set("remarks", remarks);
  upload.set("photo", photo);

  try {
    await apiWriteMultipart("/api/enforcement/crimes", upload);
  } catch (err: any) {
    return { error: err.message };
  }

  revalidatePath("/enforcement");
  revalidatePath("/matatus");
  revalidatePath("/revenue");
  redirect("/enforcement");
}

export async function verifySaccoAction(saccoId: string, status: "ACTIVE" | "REJECTED", reason?: string) {
  try {
    await apiWrite(`/api/saccos/${saccoId}/verification`, "PATCH", { status, reason });
  } catch {}
  revalidatePath("/saccos/verify");
  revalidatePath("/sacco-portal");
  revalidatePath("/dashboard");
}

export async function updateMatatuStatusAction(matatuId: string, status: MatatuStatus) {
  await apiWrite(`/api/matatus/${matatuId}/status`, "PATCH", { status });
  revalidatePath(`/matatus/${matatuId}`);
  revalidatePath("/matatus");
  revalidatePath("/dashboard");
}

export async function addActivityAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const matatuId = String(formData.get("matatuId") || "");
  const type = String(formData.get("type") || "TRIP");
  const location = String(formData.get("location") || "").trim();
  const description = String(formData.get("description") || "").trim();

  if (!matatuId || !location || !description) return { error: "All fields are required." };

  try {
    await apiWrite("/api/activity", "POST", {
      matatuId,
      type,
      location,
      description,
    });
  } catch (err: any) {
    return { error: err.message };
  }

  revalidatePath("/activity");
  revalidatePath(`/matatus/${matatuId}`);
  redirect("/activity");
}

export async function issueFineAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const matatuId = String(formData.get("matatuId") || "");
  const reason = String(formData.get("reason") || "").trim();
  const amountKes = Number(formData.get("amountKes") || 0);
  const dueDate = String(formData.get("dueDate") || "");

  if (!matatuId || !reason || !amountKes || !dueDate) return { error: "All fields are required." };

  try {
    await apiWrite("/api/fines", "POST", {
      matatuId,
      reason,
      amountKes,
      dueDate,
    });
  } catch (err: any) {
    return { error: err.message };
  }

  revalidatePath("/fines");
  revalidatePath(`/matatus/${matatuId}`);
  revalidatePath("/dashboard");
  redirect("/fines");
}

export async function markFinePaidAction(fineId: string) {
  await apiWrite(`/api/fines/${fineId}/status`, "PATCH", { status: "PAID" });
  revalidatePath("/fines");
  revalidatePath("/revenue");
  revalidatePath("/sacco-portal");
  revalidatePath("/dashboard");
}

export async function submitLicenseRenewalAction(saccoId: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/saccos/${saccoId}/license/submit-payment`, "POST");
  } catch (err: any) {
    return { error: err.message || "Could not submit renewal payment." };
  }
  revalidatePath("/sacco-portal");
  revalidatePath("/saccos/verify");
  return {};
}

export async function decideLicenseRenewalAction(saccoId: string, approve: boolean) {
  await apiWrite(`/api/saccos/${saccoId}/license/approve`, "PATCH", { approve });
  revalidatePath("/saccos/verify");
  revalidatePath("/sacco-portal");
}

export async function waiveFineAction(fineId: string) {
  await apiWrite(`/api/fines/${fineId}/status`, "PATCH", { status: "WAIVED" });
  revalidatePath("/fines");
  revalidatePath("/dashboard");
}

export async function disputeFineAction(fineId: string) {
  await apiWrite(`/api/fines/${fineId}/status`, "PATCH", { status: "DISPUTED" });
  revalidatePath("/fines");
}

export async function getTakenSeatsAction(matatuId: string): Promise<number[]> {
  try {
    return await apiWrite<number[]>(`/api/bookings/matatu/${matatuId}/taken-seats`, "GET");
  } catch {
    return [];
  }
}

export async function getTimeseriesAction(
  metric: "fines" | "bookings",
  days: number,
  grouping: "day" | "week" | "month" = "day"
): Promise<{ points: { bucket: string; count: number; value: number }[]; error?: string }> {
  try {
    const data = await apiWrite<{ points: { bucket: string; count: number; value: number }[] }>(
      `/api/analytics/timeseries?metric=${metric}&days=${days}&grouping=${grouping}`,
      "GET"
    );
    return { points: data.points };
  } catch (err: any) {
    return { points: [], error: err.message || "Could not load chart data." };
  }
}

export async function createBookingAction(input: {
  matatuId: string;
  routeId: string;
  passengerName: string;
  phone: string;
  stageName: string;
  seatNumbers: number[];
}): Promise<{ booking?: Booking; error?: string }> {
  try {
    const booking = await apiWrite<Booking>("/api/bookings", "POST", input);
    revalidatePath("/passenger-portal");
    return { booking };
  } catch (err: any) {
    return { error: err.message || "Booking failed. Please try again." };
  }
}

export async function getBookingsForMatatuAction(matatuId: string): Promise<Booking[]> {
  try {
    return await apiWrite<Booking[]>(`/api/bookings?matatu_id=${encodeURIComponent(matatuId)}`, "GET");
  } catch {
    return [];
  }
}

export async function getBookingByIdAction(bookingId: string): Promise<{ booking?: Booking; error?: string }> {
  try {
    const booking = await apiWrite<Booking>(`/api/bookings/${bookingId}`, "GET");
    return { booking };
  } catch (err: any) {
    return { error: err.message || "Ticket not found." };
  }
}

export async function updateBookingStatusAction(
  bookingId: string,
  status: "CONFIRMED" | "USED" | "CANCELLED"
): Promise<{ booking?: Booking; error?: string }> {
  try {
    const booking = await apiWrite<Booking>(`/api/bookings/${bookingId}/status`, "PATCH", { status });
    revalidatePath("/crew-portal");
    revalidatePath("/passenger-portal");
    return { booking };
  } catch (err: any) {
    return { error: err.message || "Could not update ticket status." };
  }
}

export async function getRouteStagesAction(routeId: string, direction: string = "OUTBOUND"): Promise<import("./types").RouteStagePoint[]> {
  try {
    return await apiWrite(`/api/routes/${encodeURIComponent(routeId)}/stages?direction=${direction}`, "GET");
  } catch {
    return [];
  }
}

export async function getActiveTripAction(matatuId: string): Promise<import("./types").Trip | null> {
  try {
    return await apiWrite(`/api/trips/active?matatu_id=${encodeURIComponent(matatuId)}`, "GET");
  } catch {
    return null;
  }
}

export async function getQueueStatusAction(matatuId: string): Promise<import("./types").QueueStatus | null> {
  try {
    return await apiWrite(`/api/trips/queue?matatu_id=${encodeURIComponent(matatuId)}`, "GET");
  } catch {
    return null;
  }
}

export async function activateTripAction(input: {
  matatuId: string;
  originStageId: string;
  destinationStageId: string;
}): Promise<{ trip?: import("./types").Trip; error?: string }> {
  try {
    const trip = await apiWrite<import("./types").Trip>("/api/trips/activate", "POST", {
      matatuId: input.matatuId,
      originStageId: input.originStageId,
      destinationStageId: input.destinationStageId,
    });
    return { trip };
  } catch (err: any) {
    return { error: err.message || "Could not activate trip." };
  }
}

export async function departTripAction(tripId: string): Promise<{ trip?: import("./types").Trip; error?: string }> {
  try {
    const trip = await apiWrite<import("./types").Trip>(`/api/trips/${tripId}/depart`, "POST");
    return { trip };
  } catch (err: any) {
    return { error: err.message || "Could not mark trip as departed." };
  }
}

export async function completeTripAction(
  tripId: string,
  passengerCount?: number
): Promise<{ trip?: import("./types").Trip; error?: string }> {
  try {
    const trip = await apiWrite<import("./types").Trip>(`/api/trips/${tripId}/complete`, "POST", {
      ...(passengerCount !== undefined ? { passengerCount } : {}),
    });
    return { trip };
  } catch (err: any) {
    return { error: err.message || "Could not complete trip." };
  }
}

export async function setFavoriteSaccoAction(saccoId: string | null): Promise<{ error?: string }> {
  try {
    await apiWrite("/api/users/me/favorite-sacco", "PATCH", { saccoId });
  } catch (err: any) {
    return { error: err.message || "Could not save your favorite operator." };
  }
  revalidatePath("/passenger-portal");
  return {};
}

export async function searchStagesAction(q: string): Promise<{ id: string; name: string; lat: number; lng: number }[]> {
  if (!q.trim()) return [];
  try {
    return await apiWrite(`/api/search/stages?q=${encodeURIComponent(q.trim())}`, "GET");
  } catch {
    return [];
  }
}

export async function alertCrewAction(input: { message: string; matatuId?: string }): Promise<{ notified?: number; error?: string }> {
  try {
    const result = await apiWrite<{ notified: number }>("/api/crew/alert", "POST", {
      message: input.message,
      matatuId: input.matatuId || undefined,
    });
    return { notified: result.notified };
  } catch (err: any) {
    return { error: err.message || "Could not send the alert." };
  }
}

export async function logCrewIncidentAction(input: {
  matatuId: string;
  location: string;
  description: string;
}): Promise<{ error?: string }> {
  try {
    await apiWrite("/api/activity", "POST", {
      matatuId: input.matatuId,
      type: "INCIDENT",
      location: input.location,
      description: input.description,
    });
  } catch (err: any) {
    return { error: err.message || "Could not send incident alert." };
  }
  return {};
}

export async function submitReportAction(input: {
  matatuRegNumber?: string;
  category: string;
  message: string;
  reporterName?: string;
  reporterPhone?: string;
  photo?: File | null;
}): Promise<{ report?: PassengerReport; error?: string }> {
  const formData = new FormData();
  formData.set("category", input.category);
  formData.set("message", input.message);
  if (input.matatuRegNumber) formData.set("matatu_reg_number", input.matatuRegNumber);
  if (input.reporterName) formData.set("reporter_name", input.reporterName);
  if (input.reporterPhone) formData.set("reporter_phone", input.reporterPhone);
  if (input.photo && input.photo.size > 0) formData.set("photo", input.photo);

  try {
    const report = await apiWriteMultipart("/api/reports", formData);
    return { report };
  } catch (err: any) {
    return { error: err.message || "Could not submit report. Please try again." };
  }
}

export async function submitPublicCommentAction(input: {
  message: string;
  name?: string;
  phone?: string;
}): Promise<{ ok?: boolean; error?: string }> {
  const formData = new FormData();
  formData.set("message", input.message);
  if (input.name) formData.set("reporter_name", input.name);
  if (input.phone) formData.set("reporter_phone", input.phone);

  try {
    await apiWriteMultipart("/api/reports/public-comment", formData);
    return { ok: true };
  } catch (err: any) {
    return { error: err.message || "Could not send your comment. Please try again." };
  }
}

export async function getCrewReportsAction(regNumber: string): Promise<PassengerReport[]> {
  const reports = await getReports();
  return reports
    .filter((r) => (r.matatuRegNumber || "").toUpperCase() === regNumber.toUpperCase())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 10);
}

export async function reviewReportAction(reportId: string, status: ReportStatus) {
  await apiWrite(`/api/reports/${reportId}/status`, "PATCH", { status });
  revalidatePath("/enforcement");
}

export async function addUserAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "VIEWER") as Role;
  const saccoId = String(formData.get("saccoId") || "") || undefined;

  if (!name || !email || !password) return { error: "All fields are required." };

  try {
    await apiWrite("/api/users", "POST", {
      name,
      email,
      password,
      role,
      saccoId: role === "SACCO_OPERATOR" ? saccoId : undefined,
    });
  } catch (err: any) {
    return { error: err.message };
  }

  revalidatePath("/users");
  redirect("/users");
}

export async function updateUserAction(
  userId: string,
  input: { name?: string; email?: string; role?: Role; saccoId?: string | null; newPassword?: string }
): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/users/${userId}`, "PATCH", input);
  } catch (err: any) {
    return { error: err.message || "Could not update user." };
  }
  revalidatePath("/users");
  return {};
}

export async function forgotPasswordAction(
  _prevState: { message?: string; error?: string } | undefined,
  formData: FormData
): Promise<{ message?: string; error?: string }> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { error: "Enter your account email." };
  const turnstileToken = formData.get("cf-turnstile-response");

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, turnstileToken: turnstileToken ? String(turnstileToken) : undefined }),
      cache: "no-store",
    });
    const data = await res.json();
    return { message: data.message || "If that email is registered, a password reset link has been sent." };
  } catch {
    return { error: "Could not process your request. Please try again." };
  }
}

export async function resetPasswordAction(
  _prevState: { message?: string; error?: string } | undefined,
  formData: FormData
): Promise<{ message?: string; error?: string }> {
  const token = String(formData.get("token") || "").trim();
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!token) return { error: "Missing or invalid reset link." };
  if (newPassword.length < 6) return { error: "Password must be at least 6 characters." };
  if (newPassword !== confirmPassword) return { error: "Passwords do not match." };

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data.detail || "Could not reset your password." };
    }
    return { message: data.message || "Password updated. You can now sign in." };
  } catch {
    return { error: "Could not process your request. Please try again." };
  }
}

// --- Phone-based password reset (OTP), the public app's forgot-password
// flow: request a code by phone, then submit that code + a new password.
// Two separate actions/steps rather than one, since the UI needs to know
// when to swap the "enter phone" form for the "enter code" form.
export async function requestPhoneOtpAction(
  _prevState: { step?: "otp"; phone?: string; error?: string } | undefined,
  formData: FormData
): Promise<{ step?: "otp"; phone?: string; error?: string }> {
  const phone = String(formData.get("phone") || "").trim();
  if (!phone) return { error: "Enter your phone number." };

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/forgot-password-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data.detail || "Could not process your request. Please try again." };
    }
    return { step: "otp", phone };
  } catch {
    return { error: "Could not process your request. Please try again." };
  }
}

export async function resetPasswordWithOtpAction(
  _prevState: { message?: string; error?: string } | undefined,
  formData: FormData
): Promise<{ message?: string; error?: string }> {
  const phone = String(formData.get("phone") || "").trim();
  const otp = String(formData.get("otp") || "").trim();
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!phone) return { error: "Missing phone number. Please start over." };
  if (!otp) return { error: "Enter the code we sent you." };
  if (newPassword.length < 6) return { error: "Password must be at least 6 characters." };
  if (newPassword !== confirmPassword) return { error: "Passwords do not match." };

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/reset-password-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, otp, newPassword }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data.detail || "Could not reset your password." };
    }
    return { message: data.message || "Password updated. You can now sign in." };
  } catch {
    return { error: "Could not process your request. Please try again." };
  }
}

type CrewIssueState = {
  error?: string;
  success?: {
    crewName: string;
    crewPhone: string;
    crewNumber: string;
    generatedPassword: string;
    matatuRegNumber: string;
  };
};

// Doesn't redirect (unlike onboardSaccoVehicleAction) — the generated
// password is shown to the operator exactly once, so the modal that calls
// this stays open on success to display it.
export async function issueCrewCredentialsAction(
  _prevState: CrewIssueState | undefined,
  formData: FormData
): Promise<CrewIssueState> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const licenseNumber = String(formData.get("licenseNumber") || "").trim();
  const matatuId = String(formData.get("matatuId") || "");
  const crewRole = String(formData.get("crewRole") || "DRIVER");

  // Phone is now the crew member's real login — required. Email stays
  // optional (a placeholder is synthesized server-side if omitted, see
  // backend/app/routes/crew.py's issue_crew_credentials).
  if (!name || !phone || !matatuId) {
    return { error: "Name, phone number, and vehicle are required." };
  }

  try {
    const data = await apiWrite<{
      assignment: { userName: string; userPhone: string; crewNumber: string; matatuRegNumber: string };
      generatedPassword: string;
      crewNumber: string;
    }>("/api/crew", "POST", { name, email: email || undefined, phone, licenseNumber: licenseNumber || undefined, matatuId, crewRole });
    revalidatePath("/sacco-portal");
    return {
      success: {
        crewName: data.assignment.userName,
        crewPhone: data.assignment.userPhone,
        crewNumber: data.crewNumber,
        generatedPassword: data.generatedPassword,
        matatuRegNumber: data.assignment.matatuRegNumber,
      },
    };
  } catch (err: any) {
    return { error: err.message || "Could not issue crew credentials." };
  }
}

export async function revokeCrewAssignmentAction(assignmentId: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/crew/${assignmentId}/revoke`, "PATCH");
  } catch (err: any) {
    return { error: err.message || "Could not revoke this crew assignment." };
  }
  revalidatePath("/sacco-portal");
  return {};
}

export async function removeCrewMemberAction(userId: string): Promise<{ error?: string }> {
  try {
    await apiWrite(`/api/crew/user/${userId}/deactivate`, "PATCH");
  } catch (err: any) {
    return { error: err.message || "Could not remove this crew member." };
  }
  revalidatePath("/sacco-portal");
  return {};
}
