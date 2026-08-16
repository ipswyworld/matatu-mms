import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, UserCog, Gavel, Ban, AlertTriangle, MapPin } from "lucide-react";
import { readSession } from "@/lib/session";
import { getMatatus, getActivity, getFines, getUsers, getCrimes, getRoutes, getReports, getEnforcementCases, getOfficerAssignments, getZones, getBeats } from "@/lib/data";
import { can } from "@/lib/rbac";
import StatCard from "@/components/StatCard";
import { MatatuStatusPill, FineStatusPill } from "@/components/StatusPill";
import CrimeRecordModal from "@/components/CrimeRecordModal";
import ReportsReviewPanel from "@/components/ReportsReviewPanel";
import PageBanner from "@/components/PageBanner";
import ExportCsvButton from "@/components/ExportCsvButton";
import EnforcementTabs from "@/components/EnforcementTabs";
import OfficerAssignmentRow from "@/components/OfficerAssignmentRow";
import EnforcementMap from "@/components/EnforcementMap";
import OnPatrolToggle from "@/components/OnPatrolToggle";

export const metadata: Metadata = { title: "Enforcement Operations" };

const ENFORCEMENT_FIELD_ROLES = ["ENFORCEMENT", "ARRESTING_OFFICER", "RELEASING_OFFICER", "ENFORCEMENT_COMMANDER"];

export default async function EnforcementPage() {
  const session = readSession()!;
  const canManageAssignments = can(session.role, "manage_officer_assignments");

  const [matatus, activities, fines, users, crimes, routes, reports, enforcementCases, officerAssignments, zones, beats] = await Promise.all([
    getMatatus(),
    getActivity(),
    getFines(),
    getUsers(),
    getCrimes(),
    getRoutes(),
    can(session.role, "view_reports") ? getReports() : Promise.resolve([]),
    can(session.role, "view_enforcement_cases") ? getEnforcementCases() : Promise.resolve([]),
    canManageAssignments ? getOfficerAssignments() : Promise.resolve([]),
    canManageAssignments ? getZones() : Promise.resolve([]),
    canManageAssignments ? getBeats() : Promise.resolve([]),
  ]);

  const commanders = officerAssignments.filter((o) => o.role === "ENFORCEMENT_COMMANDER");
  const fieldOfficers = officerAssignments.filter((o) => o.role !== "ENFORCEMENT_COMMANDER");

  const openEnforcementCases = enforcementCases.filter((c) => c.status === "ARRESTED" || c.status === "PAID");

  const officerUsers = users.filter((u) =>
    ["ENFORCEMENT", "ADMIN", "ARRESTING_OFFICER", "RELEASING_OFFICER", "ENFORCEMENT_COMMANDER"].includes(u.role)
  );
  const impoundedVehicles = matatus.filter((m) => m.status === "IMPOUNDED");
  const flaggedVehicles = matatus.filter((m) => m.status === "FLAGGED");
  const pendingFines = fines.filter((f) => f.status === "PENDING");

  const recentInspections = activities
    .filter((a) => a.type === "INSPECTION" || a.type === "INCIDENT")
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const matatuMap = new Map(matatus.map((m) => [m.id, m]));

  // Real per-corridor compliance derived from actual fleet + flag/impound status (no fake patrol zone data)
  const corridorCompliance = routes.map((r) => {
    const vehiclesOnRoute = matatus.filter((m) => m.routeId === r.id);
    const flaggedCount = vehiclesOnRoute.filter((m) => m.status === "FLAGGED" || m.status === "IMPOUNDED").length;
    return {
      route: r,
      vehicleCount: vehiclesOnRoute.length,
      flaggedCount,
    };
  });

  return (
    <div className="space-y-6">
      <PageBanner
        icon={ShieldAlert}
        eyebrow="Nairobi City County · Enforcement"
        title="Enforcement Operations Hub"
        subtitle="Officer deployments, crime recording, impoundment logs, and field compliance checkpoints, all fed by real fleet and passenger-report data."
        action={
          <>
            <ExportCsvButton
              filename="crime-citation-ledger"
              headers={["Date", "Offence", "Plate Number", "Driver", "License", "Location", "Penalty (KES)", "Officer", "Status"]}
              rows={crimes.map((c) => [
                new Date(c.timestamp).toLocaleString(),
                c.offenceCommitted,
                c.regNumber,
                c.driverName,
                c.driverLicense,
                c.location,
                c.fineAmountKes,
                c.officerName || userMap.get(c.officerId) || "Enforcement Officer",
                c.status,
              ])}
            />
            {can(session.role, "record_crime") && <CrimeRecordModal matatus={matatus} />}
            {can(session.role, "log_activity") && (
              <Link href="/activity/new" className="rounded-lg px-3.5 py-2 text-xs font-bold bg-white/10 text-white hover:bg-white/15 transition-colors">
                + Log Checkpoint
              </Link>
            )}
          </>
        }
      />

      <EnforcementTabs
        operationsContent={
          <>
      {ENFORCEMENT_FIELD_ROLES.includes(session.role) && (
        <OnPatrolToggle officerId={session.userId} token={session.token || ""} />
      )}
      {can(session.role, "view_enforcement_cases") && (
        <div className="rounded-2xl bg-county-green-deep text-white p-5 flex flex-wrap items-center justify-between gap-4 shadow-elevated">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-county-yellow">Arrest → Release Workflow</div>
            <div className="text-lg font-black tracking-tight mt-1">
              {openEnforcementCases.length} case{openEnforcementCases.length !== 1 ? "s" : ""} open in the queue
            </div>
          </div>
          <div className="flex gap-2">
            {can(session.role, "file_enforcement_case") && (
              <Link href="/enforcement/scene" className="rounded-lg px-4 py-2.5 text-sm font-bold bg-white/10 text-white hover:bg-white/15 transition-colors">
                Report Offence →
              </Link>
            )}
            <Link href="/enforcement/cases" className="rounded-lg px-4 py-2.5 text-sm font-bold bg-county-yellow text-county-green-deep hover:bg-county-yellow-dark transition-colors shadow-sm">
              Case Queue →
            </Link>
          </div>
        </div>
      )}

      {/* Enforcement Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Patrol Officers" value={officerUsers.length} hint="Assigned county personnel" icon={UserCog} />
        <StatCard label="Recorded Offences / Crimes" value={crimes.length} accent="red" hint="Total traffic & compliance citations" icon={Gavel} />
        <StatCard label="Impounded Vehicles" value={impoundedVehicles.length} accent="red" hint="Holding yard status" icon={Ban} />
        <StatCard label="Flagged for Stop" value={flaggedVehicles.length} accent="red" hint="Pending compliance review" icon={AlertTriangle} />
      </div>

      {/* Crime & Offence Ledger Table */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-county-black">Recorded Offence & Crime Ledger</h3>
            <p className="text-xs text-black/50">Citations recorded in the field by traffic officers with driver details and number plates.</p>
          </div>
          <span className="badge bg-county-red/10 text-county-red font-bold">
            {crimes.length} Logged Offence{crimes.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
              <tr>
                <th className="p-2.5">Date & Time</th>
                <th className="p-2.5">Offence Committed</th>
                <th className="p-2.5">Plate Number</th>
                <th className="p-2.5">Driver & License</th>
                <th className="p-2.5">Location</th>
                <th className="p-2.5">Penalty (KES)</th>
                <th className="p-2.5">Officer</th>
                <th className="p-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {crimes.map((c) => (
                <tr key={c.id} className="hover:bg-black/[0.02]">
                  <td className="p-2.5 text-black/50 font-mono">
                    {new Date(c.timestamp).toLocaleString()}
                  </td>
                  <td className="p-2.5 font-bold text-county-red">
                    {c.offenceCommitted}
                  </td>
                  <td className="p-2.5 font-mono font-bold text-county-black">
                    {c.regNumber}
                  </td>
                  <td className="p-2.5">
                    <div className="font-semibold text-county-black">{c.driverName}</div>
                    <div className="text-[10px] text-black/50 font-mono">{c.driverLicense}</div>
                  </td>
                  <td className="p-2.5 font-medium">{c.location}</td>
                  <td className="p-2.5 font-bold text-county-black">
                    KES {c.fineAmountKes.toLocaleString()}
                  </td>
                  <td className="p-2.5 text-black/70">
                    {c.officerName || userMap.get(c.officerId) || "Enforcement Officer"}
                  </td>
                  <td className="p-2.5">
                    <span className="badge bg-amber-100 text-amber-700 font-bold">
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
              {crimes.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-black/40">
                    No offences or crimes recorded yet. Click &quot;+ Record Crime / Citation&quot; to log an offence.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Route Corridor Compliance — derived from real fleet + flag/impound status */}
      <div className="card p-5">
        <h3 className="font-bold text-sm mb-3">Route Corridor Compliance</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {corridorCompliance.map(({ route, vehicleCount, flaggedCount }) => (
            <div key={route.id} className="border border-black/10 rounded-lg p-3 bg-black/[0.01]">
              <div className="flex justify-between items-start mb-2">
                <span className="font-mono text-xs font-bold text-black/50">Route {route.code}</span>
                <span className={`badge ${flaggedCount > 0 ? "bg-amber-100 text-amber-700" : "bg-county-green/10 text-county-green"}`}>
                  {flaggedCount > 0 ? "Needs Attention" : "Compliant"}
                </span>
              </div>
              <div className="font-bold text-sm text-county-black">{route.name}</div>
              <div className="text-xs text-black/60 mt-2">
                {vehicleCount} vehicle{vehicleCount !== 1 ? "s" : ""} · {flaggedCount} flagged/impounded
              </div>
            </div>
          ))}
        </div>
      </div>

      {can(session.role, "view_reports") && (
        <ReportsReviewPanel reports={reports} />
      )}

      {/* Pending Fines Summary */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-county-black">Pending Fines</h3>
          <Link href="/fines" className="text-xs font-semibold text-county-green hover:underline">
            Full fines ledger →
          </Link>
        </div>
        {pendingFines.length === 0 ? (
          <p className="text-sm text-black/40 py-4 text-center">No pending fines outstanding.</p>
        ) : (
          <div className="space-y-2">
            {pendingFines.slice(0, 5).map((f) => (
              <div key={f.id} className="flex items-center justify-between text-sm border-b border-black/5 pb-2 last:border-0">
                <div>
                  <span className="font-semibold text-county-black">{f.regNumber}</span>
                  <span className="text-xs text-black/50 ml-2">{f.reason}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-county-black">KES {f.amountKes.toLocaleString()}</span>
                  <FineStatusPill status={f.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Impounded & Flagged Fleet Registry */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Impounded & Flagged Fleet</h3>
            <Link href="/matatus" className="text-xs font-semibold text-county-green hover:underline">
              Full registry →
            </Link>
          </div>
          <div className="space-y-3">
            {impoundedVehicles.concat(flaggedVehicles).length === 0 && (
              <p className="text-sm text-black/40 py-4 text-center">No vehicles impounded or flagged.</p>
            )}
            {impoundedVehicles.concat(flaggedVehicles).map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm border-b border-black/5 pb-2 last:border-0">
                <div>
                  <Link href={`/matatus/${m.id}`} className="font-semibold text-county-green hover:underline">
                    {m.regNumber}
                  </Link>
                  <div className="text-xs text-black/50">Capacity: {m.capacity} seats · Segment: {m.terminalSegment || "CBD Stage"}</div>
                </div>
                <MatatuStatusPill status={m.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Recent Field Inspections & Checkpoints */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Recent Field Checkpoints</h3>
            <Link href="/activity" className="text-xs font-semibold text-county-green hover:underline">
              Activity log →
            </Link>
          </div>
          <div className="space-y-3">
            {recentInspections.length === 0 && (
              <p className="text-sm text-black/40 py-4 text-center">No recent field checkpoints recorded.</p>
            )}
            {recentInspections.map((a) => {
              const m = matatuMap.get(a.matatuId);
              return (
                <div key={a.id} className="text-sm border-b border-black/5 pb-2 last:border-0">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">{m?.regNumber || "Unknown"}</span>
                    <span className="text-xs text-black/40">{new Date(a.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-black/70 mt-1">{a.description}</p>
                  <p className="text-[11px] text-black/40 mt-0.5">{a.location} · Officer: {userMap.get(a.officerId) || "System"}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
          </>
        }
        commandContent={
          canManageAssignments ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
                  <MapPin size={15} strokeWidth={2} className="text-county-ink/50" />
                  Live Map — Officers, Vehicles & Beats
                </h3>
                <EnforcementMap beats={beats} zones={zones} token={session.token || ""} />
              </div>

              <div className="card p-5 space-y-3">
                <h3 className="font-bold text-sm text-county-black">Commander Titles</h3>
                <p className="text-xs text-black/50">Top enforcement leadership — Commander of Public Transport Compliance, Traffic, Parking, etc.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Officer</th>
                        <th className="p-2.5">Role</th>
                        <th className="p-2.5">Commander Title</th>
                        <th className="p-2.5"></th>
                        <th className="p-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {commanders.map((o) => (
                        <OfficerAssignmentRow key={o.id} officer={o} zones={zones} />
                      ))}
                      {commanders.length === 0 && (
                        <tr><td colSpan={5} className="text-center py-6 text-black/40">No commanders onboarded yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card p-5 space-y-3">
                <h3 className="font-bold text-sm text-county-black">Daily Duty & Zone Assignment</h3>
                <p className="text-xs text-black/50">
                  Arresting and Releasing duties never mix on the same officer for the same period. Assign a patrol zone/corridor to
                  each Arresting Officer.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Officer</th>
                        <th className="p-2.5">Role</th>
                        <th className="p-2.5">Duty Today</th>
                        <th className="p-2.5">Zone / Corridor</th>
                        <th className="p-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {fieldOfficers.map((o) => (
                        <OfficerAssignmentRow key={o.id} officer={o} zones={zones} />
                      ))}
                      {fieldOfficers.length === 0 && (
                        <tr><td colSpan={5} className="text-center py-6 text-black/40">No field officers onboarded yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card p-5 space-y-3">
                <h3 className="font-bold text-sm text-county-black">Full Case Ledger — Arrest & Release Actions</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Case Reference</th>
                        <th className="p-2.5">Plate</th>
                        <th className="p-2.5">Offence</th>
                        <th className="p-2.5">Fine (KES)</th>
                        <th className="p-2.5">Arrested By</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Released/Decided By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {enforcementCases.map((c) => (
                        <tr key={c.id} className="hover:bg-black/[0.02]">
                          <td className="p-2.5 font-mono font-bold text-county-black">{c.caseReference}</td>
                          <td className="p-2.5 font-mono font-bold">{c.regNumber}</td>
                          <td className="p-2.5">{c.offenceName}</td>
                          <td className="p-2.5 font-bold">{c.fineAmountKes.toLocaleString()}</td>
                          <td className="p-2.5">{c.arrestingOfficerName}</td>
                          <td className="p-2.5">
                            <span className="badge bg-black/5 text-black/70 font-bold">{c.status}</span>
                          </td>
                          <td className="p-2.5">{c.releasingOfficerName || "—"}</td>
                        </tr>
                      ))}
                      {enforcementCases.length === 0 && (
                        <tr><td colSpan={7} className="text-center py-6 text-black/40">No enforcement cases filed yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
