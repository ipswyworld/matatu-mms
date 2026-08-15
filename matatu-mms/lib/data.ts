import { redirect } from "next/navigation";
import { readSession } from "./session";
import { ActivityLog, AuditLog, Booking, EnforcementCase, Fine, Matatu, OfficerAssignment, OffenceType, PassengerReport, Route, Sacco, SystemHealth, User, Zone } from "./types";

// Server-side calls run inside the Docker network (or on the same host in
// dev) — overridable via BACKEND_URL so docker-compose can point this at
// the internal service name ("http://backend:8000") instead of localhost.
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

/**
 * Helper to perform authenticated HTTP requests to the Python FastAPI backend.
 */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = readSession();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  } as Record<string, string>;

  // Attach JWT token from cookie if user is authenticated
  if (session?.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }

  // Next.js caching control: disable caching for dynamic operations
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 401) {
      redirect("/login");
    }
    const errorText = await res.text();
    let errorMessage = `API request to ${path} failed with status ${res.status}`;
    try {
      errorMessage = JSON.parse(errorText).detail || errorMessage;
    } catch {}
    throw new Error(errorMessage);
  }

  return res.json() as Promise<T>;
}

// ---------- Reads (Asynchronous fetches from Python Backend) ----------

export async function getUsers(): Promise<User[]> {
  return apiFetch<User[]>("/api/users");
}

export async function getUserById(id: string): Promise<User | undefined> {
  const users = await getUsers();
  return users.find((u) => u.id === id);
}

export async function getSaccos(): Promise<Sacco[]> {
  return apiFetch<Sacco[]>("/api/saccos");
}

export async function getSaccoById(id: string): Promise<Sacco | undefined> {
  const saccos = await getSaccos();
  return saccos.find((s) => s.id === id);
}

export async function getRoutes(): Promise<Route[]> {
  return apiFetch<Route[]>("/api/routes");
}

export async function getRouteById(id: string): Promise<Route | undefined> {
  const routes = await getRoutes();
  return routes.find((r) => r.id === id);
}

export async function getMatatus(): Promise<Matatu[]> {
  return apiFetch<Matatu[]>("/api/matatus");
}

export async function getMatatuById(id: string): Promise<Matatu | undefined> {
  return apiFetch<Matatu>(`/api/matatus/${id}`);
}

// Backend defaults to the most recent 200 records, not the whole table.
export async function getActivity(limit?: number): Promise<ActivityLog[]> {
  return apiFetch<ActivityLog[]>(limit !== undefined ? `/api/activity?limit=${limit}` : "/api/activity");
}

export async function getActivityForMatatu(matatuId: string): Promise<ActivityLog[]> {
  const matatu = await getMatatuById(matatuId);
  return matatu?.activities || [];
}

export async function getFines(): Promise<Fine[]> {
  return apiFetch<Fine[]>("/api/fines");
}

export async function getFinesForMatatu(matatuId: string): Promise<Fine[]> {
  const matatu = await getMatatuById(matatuId);
  return matatu?.fines || [];
}

// The backend defaults to the most recent 100 records (keyset-paginated,
// not the whole table) — pass `limit` explicitly for callers that need a
// different page size. beforeId continues further back using the last
// returned record's id as the cursor.
export async function getAuditLogs(limit?: number, beforeId?: number): Promise<AuditLog[]> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  // Backend Query() params (unlike Pydantic body models) aren't camelCase-
  // aliased, so this has to match the Python parameter name exactly.
  if (beforeId !== undefined) params.set("before_id", String(beforeId));
  const qs = params.toString();
  return apiFetch<AuditLog[]>(`/api/audit-logs${qs ? `?${qs}` : ""}`);
}

export async function getSystemHealth(): Promise<SystemHealth> {
  return apiFetch<SystemHealth>("/api/system/health");
}

export async function getCrimes(): Promise<import("./types").CrimeRecord[]> {
  return apiFetch<import("./types").CrimeRecord[]>("/api/enforcement/crimes");
}

export async function getTakenSeats(matatuId: string): Promise<number[]> {
  return apiFetch<number[]>(`/api/bookings/matatu/${matatuId}/taken-seats`);
}

export async function getMyBookings(): Promise<Booking[]> {
  return apiFetch<Booking[]>("/api/bookings");
}

export async function getBookingsForMatatu(matatuId: string): Promise<Booking[]> {
  // Backend query param is a plain FastAPI function arg (snake_case), not camelCase-aliased.
  return apiFetch<Booking[]>(`/api/bookings?matatu_id=${encodeURIComponent(matatuId)}`);
}

export async function getReports(): Promise<PassengerReport[]> {
  return apiFetch<PassengerReport[]>("/api/reports");
}

export interface LiveVehicleTelemetry {
  matatu_id: string;
  reg_number: string;
  route_code: string;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
}

export async function getFleetTelemetry(): Promise<LiveVehicleTelemetry[]> {
  return apiFetch<LiveVehicleTelemetry[]>("/api/telemetry/matatus");
}

export async function getZones(): Promise<Zone[]> {
  return apiFetch<Zone[]>("/api/enforcement/zones");
}

export async function getOffenceTypes(): Promise<OffenceType[]> {
  return apiFetch<OffenceType[]>("/api/enforcement/offence-types");
}

export async function getEnforcementCases(): Promise<EnforcementCase[]> {
  return apiFetch<EnforcementCase[]>("/api/enforcement/cases");
}

export async function getOfficerAssignments(): Promise<OfficerAssignment[]> {
  return apiFetch<OfficerAssignment[]>("/api/enforcement/officer-assignments");
}
