"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSessionCookie, readSession, setSessionCookie } from "./session";
import { Booking, MatatuStatus, PassengerReport, ReportStatus, Role } from "./types";

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
      return { error: "Invalid email or password." };
    }

    const data = await res.json();
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
    return { error: err.message || "Failed to reach authentication server." };
  }
}

export async function registerAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "PASSENGER") as Role;
  const saccoId = String(formData.get("saccoId") || "").trim() || undefined;
  const signature = String(formData.get("signature") || "").trim();

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
        saccoId,
        termsAccepted: true,
        termsSignature: signature,
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
  docType: string,
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

export async function publicLookupCaseAction(caseReference: string): Promise<{ error?: string; caseData?: any }> {
  try {
    const res = await fetch(`${PUBLIC_BACKEND_URL}/api/enforcement/cases/public/${encodeURIComponent(caseReference.trim())}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const errText = await res.text();
      let msg = "Case not found.";
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
  const fareKes = Number(formData.get("fareKes") || 0);

  if (!code || !name || !fareKes) {
    return { error: "Route code, name, and fare are required." };
  }

  const id = `route-${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

  try {
    await apiWrite("/api/routes", "POST", { id, code, name, description, fareKes });
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
  const offenceCommitted = String(formData.get("offenceCommitted") || "").trim();
  const regNumber = String(formData.get("regNumber") || "").trim().toUpperCase();
  const driverName = String(formData.get("driverName") || "").trim();
  const driverLicense = String(formData.get("driverLicense") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const fineAmountKes = Number(formData.get("fineAmountKes") || 0);
  const remarks = String(formData.get("remarks") || "").trim();

  if (!offenceCommitted || !regNumber || !location) {
    return { error: "Offence committed, plate number, and location are required." };
  }

  try {
    await apiWrite("/api/enforcement/crimes", "POST", {
      offenceCommitted,
      regNumber,
      driverName: driverName || "Unidentified Driver",
      driverLicense: driverLicense || "N/A",
      location,
      fineAmountKes,
      remarks,
    });
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
}): Promise<{ report?: PassengerReport; error?: string }> {
  try {
    const report = await apiWrite<PassengerReport>("/api/reports", "POST", input);
    return { report };
  } catch (err: any) {
    return { error: err.message || "Could not submit report. Please try again." };
  }
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
