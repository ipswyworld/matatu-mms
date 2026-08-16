import type { Metadata } from "next";
import { MessageSquare, ShieldCheck, MessageSquareWarning, CheckCircle2, Route as RouteIcon } from "lucide-react";
import { readSession } from "@/lib/session";
import { getRoutes, getMatatus, getReports } from "@/lib/data";
import { can } from "@/lib/rbac";
import StatCard from "@/components/StatCard";
import PageBanner from "@/components/PageBanner";
import EmptyState from "@/components/EmptyState";

export const metadata: Metadata = { title: "Passenger Feedback & Safety" };

const REPORT_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  REVIEWED: "bg-county-blue/10 text-county-blue",
  ESCALATED: "bg-county-red/10 text-county-red",
  DISMISSED: "bg-black/10 text-black/50",
};

export default async function PassengersPage() {
  const session = readSession()!;
  const isSacco = session.role === "SACCO_OPERATOR";

  const [routes, allMatatus, allReports] = await Promise.all([
    getRoutes(),
    getMatatus(),
    can(session.role, "view_reports") ? getReports() : Promise.resolve([]),
  ]);

  // Scoped once, server-side: an operator's complaint data never leaves the
  // server for other operators' vehicles — same pattern as /revenue and
  // /matatus. Route definitions themselves aren't operator-exclusive data,
  // so `routes` stays unfiltered.
  const matatus = isSacco ? allMatatus.filter((m) => m.saccoId === session.saccoId) : allMatatus;
  const myRegNumbers = new Set(matatus.map((m) => m.regNumber));
  const reports = isSacco ? allReports.filter((r) => r.matatuRegNumber && myRegNumbers.has(r.matatuRegNumber)) : allReports;

  const activeMatatus = matatus.filter((m) => m.status === "ACTIVE").length;
  const complianceRating = Math.round((activeMatatus / (matatus.length || 1)) * 100);
  const handledReports = reports.filter((r) => r.status === "REVIEWED" || r.status === "ESCALATED" || r.status === "DISMISSED");

  const reportsByRegNumber = new Map<string, number>();
  reports.forEach((r) => {
    if (r.matatuRegNumber) {
      reportsByRegNumber.set(r.matatuRegNumber, (reportsByRegNumber.get(r.matatuRegNumber) || 0) + 1);
    }
  });
  const regNumbersByRoute = new Map(matatus.map((m) => [m.regNumber, m.routeId]));
  const reportsByRoute = new Map<string, number>();
  reportsByRegNumber.forEach((count, regNumber) => {
    const routeId = regNumbersByRoute.get(regNumber);
    if (routeId) reportsByRoute.set(routeId, (reportsByRoute.get(routeId) || 0) + count);
  });

  return (
    <div className="space-y-6">
      <PageBanner
        icon={MessageSquare}
        eyebrow="Nairobi City County · Commuter Feedback"
        title="Passenger & Commuter Service Portal"
        subtitle="Real complaints submitted directly from the Passenger Portal app, cross-referenced against fleet and route data."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Route Fleet Quality" value={`${complianceRating}%`} hint="Overall fleet compliance index" icon={ShieldCheck} />
        <StatCard label="Public Complaints (Total)" value={reports.length} accent="red" hint="Submitted via the Passenger Portal" icon={MessageSquareWarning} />
        <StatCard label="Handled Reports" value={handledReports.length} accent="green" hint="Reviewed, escalated, or dismissed" icon={CheckCircle2} />
        <StatCard label="Active Routes Monitored" value={routes.length} hint="County matatu corridors" icon={RouteIcon} />
      </div>

      <div className="card p-5">
        <h3 className="font-bold text-sm mb-3">Route Complaint Volume</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {routes.map((r) => {
            const fleetCount = matatus.filter((m) => m.routeId === r.id).length;
            const complaintCount = reportsByRoute.get(r.id) || 0;
            return (
              <div key={r.id} className="border border-black/10 rounded-lg p-4 bg-black/[0.01]">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-sm">{r.name}</span>
                  <span className="badge bg-county-blue/10 text-county-blue">Route {r.code}</span>
                </div>
                <p className="text-xs text-black/60">{r.description}</p>
                <div className="flex justify-between items-center text-xs text-black/50 mt-3 pt-2 border-t border-black/5">
                  <span>{fleetCount} registered matatus</span>
                  <span className={`font-semibold ${complaintCount > 0 ? "text-county-red" : "text-county-green"}`}>
                    {complaintCount} complaint{complaintCount !== 1 ? "s" : ""} filed
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">Commuter Complaint Log</h3>
          <span className="text-xs text-black/40">Sorted by recent submissions</span>
        </div>
        {reports.length === 0 ? (
          <EmptyState
            title="No commuter complaints filed yet"
            hint="Reports submitted from the Passenger Portal's feedback form will appear here in real time."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Ticket ID</th>
                  <th>Vehicle</th>
                  <th>Category</th>
                  <th>Issue Description</th>
                  <th>Reported At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs font-bold">{r.id}</td>
                    <td className="font-semibold">{r.matatuRegNumber || "—"}</td>
                    <td>
                      <span className="badge bg-black/5 text-black/70">{r.category}</span>
                    </td>
                    <td className="text-xs text-black/70">{r.message}</td>
                    <td className="text-xs text-black/50">{new Date(r.createdAt).toLocaleString()}</td>
                    <td>
                      <span className={`badge text-xs font-semibold ${REPORT_STATUS_STYLES[r.status] || "bg-black/5 text-black/60"}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
