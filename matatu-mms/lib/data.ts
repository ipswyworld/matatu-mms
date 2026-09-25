import { redirect } from "next/navigation";
import { readSession } from "./session";
import { ActivityLog, AuditLog, Beat, BoardingHeatmapPoint, Booking, Broadcast, ComplianceFunnel, CrewAssignment, DutyAllocation, DutyAssignment, DutyCalendar, EnforcementCase, Fine, Matatu, MyDuty, NotificationHistory, ODMatrixCell, OfficerAssignment, OfficerRoster, OffenceType, OperatorTerminal, PassengerReport, Route, RouteGeometry, RouteRidership, Sacco, Sector, TimeseriesResponse, User, Zone, SupportTicket } from "./types";

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

export async function getSupportTickets(): Promise<SupportTicket[]> {
  return apiFetch<SupportTicket[]>("/api/support-tickets");
}

export async function getUserById(id: string): Promise<User | undefined> {
  const users = await getUsers();
  return users.find((u) => u.id === id);
}

// Any authenticated user can check a flag's state (backend's
// /api/feature-flags/{key}/enabled is intentionally not gated behind
// manage_system_config like the CRUD routes) — this is the first real
// feature-flag consumer in the codebase, gating the Role Matrix panel.
// Fails open (flag reads as enabled) rather than hiding the panel on a
// transient backend error.
export async function getFeatureFlagEnabled(key: string): Promise<boolean> {
  try {
    const res = await apiFetch<{ key: string; enabled: boolean }>(`/api/feature-flags/${encodeURIComponent(key)}/enabled`);
    return res.enabled;
  } catch {
    return true;
  }
}

export async function getSaccos(): Promise<Sacco[]> {
  return apiFetch<Sacco[]>("/api/saccos");
}

export async function getComplianceFunnel(): Promise<ComplianceFunnel> {
  return apiFetch<ComplianceFunnel>("/api/saccos/compliance-funnel");
}

export async function getSaccoById(id: string): Promise<Sacco | undefined> {
  const saccos = await getSaccos();
  return saccos.find((s) => s.id === id);
}

export async function getRoutes(): Promise<Route[]> {
  return apiFetch<Route[]>("/api/routes");
}

export async function getOperatorTerminals(): Promise<OperatorTerminal[]> {
  return apiFetch<OperatorTerminal[]>("/api/operator-terminals");
}

export async function getRouteById(id: string): Promise<Route | undefined> {
  const routes = await getRoutes();
  return routes.find((r) => r.id === id);
}

export async function getRouteNetwork(): Promise<RouteGeometry[]> {
  return apiFetch<RouteGeometry[]>("/api/routes/network");
}

export async function getMatatus(): Promise<Matatu[]> {
  return apiFetch<Matatu[]>("/api/matatus");
}

export async function getMatatuById(id: string): Promise<Matatu | undefined> {
  return apiFetch<Matatu>(`/api/matatus/${id}`);
}

export async function getCrewAssignments(activeOnly = true): Promise<CrewAssignment[]> {
  return apiFetch<CrewAssignment[]>(`/api/crew?active_only=${activeOnly}`);
}

// Server-pre-aggregated chart data (ARCHITECTURE_DECISIONS.md §23.3) — never
// fetch raw rows to chart client-side; the backend buckets by day/week/month.
export async function getTimeseries(
  metric: "fines" | "bookings",
  days = 30,
  grouping: "day" | "week" | "month" = "day"
): Promise<TimeseriesResponse> {
  return apiFetch<TimeseriesResponse>(`/api/analytics/timeseries?metric=${metric}&days=${days}&grouping=${grouping}`);
}

// Origin-destination search/booking pairs and busiest boarding stages —
// backend/app/routes/demand.py, built on the demand_signals log. Citywide,
// not Sacco-scoped (this is planning data, not fleet data), so it's shown
// the same to every role that reaches the dashboard.
export async function getOdMatrix(days = 30): Promise<ODMatrixCell[]> {
  return apiFetch<ODMatrixCell[]>(`/api/demand/od-matrix?days=${days}`);
}

export async function getBoardingHeatmap(days = 30): Promise<BoardingHeatmapPoint[]> {
  return apiFetch<BoardingHeatmapPoint[]>(`/api/demand/boarding-heatmap?days=${days}`);
}

// Real, crew-logged ridership per route — distinct from od-matrix/boarding-
// heatmap above, which only ever see app-based search/booking activity.
export async function getRidershipByRoute(days = 30): Promise<RouteRidership[]> {
  return apiFetch<RouteRidership[]>(`/api/demand/ridership-by-route?days=${days}`);
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

export interface LiveOfficerTelemetry {
  officer_id: string;
  officer_name: string;
  role: string;
  lat: number;
  lng: number;
  bearing?: number;
  speed?: number;
}

export async function getOfficerTelemetry(): Promise<LiveOfficerTelemetry[]> {
  return apiFetch<LiveOfficerTelemetry[]>("/api/telemetry/officers");
}

export async function getBeats(): Promise<Beat[]> {
  return apiFetch<Beat[]>("/api/beats");
}

export async function getZones(): Promise<Zone[]> {
  return apiFetch<Zone[]>("/api/enforcement/zones");
}

// --- PTCU duty allocation ---
// Query parameters are snake_case throughout, matching the backend's
// FastAPI Query() names — camelCase applies to request/response bodies
// (BaseModelCamel) but never to query strings, same as /api/search and
// /api/beats already do.

export async function getSectors(allocationId?: string): Promise<Sector[]> {
  const qs = allocationId ? `?allocation_id=${encodeURIComponent(allocationId)}` : "";
  return apiFetch<Sector[]>(`/api/duty/sectors${qs}`);
}

export async function getDutyZones(params: { sectorId?: string; allocationId?: string } = {}): Promise<Zone[]> {
  const search = new URLSearchParams();
  if (params.sectorId) search.set("sector_id", params.sectorId);
  if (params.allocationId) search.set("allocation_id", params.allocationId);
  const qs = search.toString();
  return apiFetch<Zone[]>(`/api/duty/zones${qs ? `?${qs}` : ""}`);
}

export async function getDutyAllocations(): Promise<DutyAllocation[]> {
  return apiFetch<DutyAllocation[]>("/api/duty/allocations");
}

export async function getDutyAssignments(
  allocationId: string,
  params: { sectorId?: string; zoneId?: string; shift?: string; onDate?: string } = {}
): Promise<DutyAssignment[]> {
  const search = new URLSearchParams();
  if (params.sectorId) search.set("sector_id", params.sectorId);
  if (params.zoneId) search.set("zone_id", params.zoneId);
  if (params.shift) search.set("shift", params.shift);
  if (params.onDate) search.set("on_date", params.onDate);
  const qs = search.toString();
  return apiFetch<DutyAssignment[]>(`/api/duty/allocations/${allocationId}/assignments${qs ? `?${qs}` : ""}`);
}

export async function getDutyCalendar(year: number, month: number): Promise<DutyCalendar> {
  return apiFetch<DutyCalendar>(`/api/duty/calendar?year=${year}&month=${month}`);
}

export async function getOfficerRoster(
  params: { allocationId?: string; sectorId?: string; zoneId?: string; dutyStatus?: string } = {}
): Promise<OfficerRoster[]> {
  const search = new URLSearchParams();
  if (params.allocationId) search.set("allocation_id", params.allocationId);
  if (params.sectorId) search.set("sector_id", params.sectorId);
  if (params.zoneId) search.set("zone_id", params.zoneId);
  if (params.dutyStatus) search.set("duty_status", params.dutyStatus);
  const qs = search.toString();
  return apiFetch<OfficerRoster[]>(`/api/duty/officers${qs ? `?${qs}` : ""}`);
}

export async function getMyDuty(): Promise<MyDuty | null> {
  // Returns null rather than throwing for a non-enforcement account: the
  // dashboard renders this panel for whoever is logged in, and a Sacco
  // operator having no duty allocation is a normal state, not an error.
  try {
    return await apiFetch<MyDuty>("/api/duty/my-duty");
  } catch {
    return null;
  }
}

export async function getSentBroadcasts(): Promise<Broadcast[]> {
  return apiFetch<Broadcast[]>("/api/broadcasts");
}

export async function getMyBroadcasts(unreadOnly = false): Promise<Broadcast[]> {
  try {
    return await apiFetch<Broadcast[]>(`/api/broadcasts/mine${unreadOnly ? "?unread_only=true" : ""}`);
  } catch {
    return [];
  }
}

export async function getNotificationHistory(): Promise<NotificationHistory> {
  try {
    return await apiFetch<NotificationHistory>("/api/notifications");
  } catch {
    return { items: [], unreadCount: 0 };
  }
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
