import type { Metadata } from "next";
import Link from "next/link";
import { Bus, ShieldCheck, Banknote, BadgeCheck, MessageSquareWarning, Clock, CheckCircle2, XCircle, FileClock, LayoutDashboard, UserX } from "lucide-react";
import { readSession } from "@/lib/session";
import { getFines, getMatatus, getActivity, getRoutes, getSaccos, getAuditLogs, getReports, getMyBookings, getFleetTelemetry } from "@/lib/data";
import { can } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";

export const metadata: Metadata = { title: "Overview" };
import StatusBreakdown from "@/components/widgets/StatusBreakdown";
import TrendChart from "@/components/widgets/TrendChart";
import KpiCard from "@/components/dashboard/KpiCard";
import ActivityFeed from "@/components/dashboard/ActivityFeed";
import CorridorHealth from "@/components/dashboard/CorridorHealth";
import BookingsPanel from "@/components/dashboard/BookingsPanel";
import FleetLiveStatus from "@/components/dashboard/FleetLiveStatus";
import DashboardLiveRefresh from "@/components/DashboardLiveRefresh";
import LiveConditions from "@/components/dashboard/LiveConditions";

export default async function DashboardPage() {
  const session = readSession()!;
  const isSacco = session.role === "SACCO_OPERATOR";

  if (session.role === "DIRECTOR_MOBILITY" || session.role === "CHIEF_OFFICER") {
    const saccos = await getSaccos();
    const isDirector = session.role === "DIRECTOR_MOBILITY";
    const stageField = isDirector ? "directorMobilityStatus" : "chiefOfficerStatus";

    const awaitingYou = saccos.filter((s) => {
      if (!s.applicationSubmittedAt) return false;
      if (isDirector) return s[stageField] === "PENDING";
      return s.directorMobilityStatus === "APPROVED" && s[stageField] === "PENDING";
    });
    const approvedByYou = saccos.filter((s) => s[stageField] === "APPROVED");
    const rejectedByYou = saccos.filter((s) => s[stageField] === "REJECTED");
    const notYetSubmitted = saccos.filter((s) => !s.applicationSubmittedAt && s.status === "PENDING_VERIFICATION");

    return (
      <div className="space-y-6">
        <PageBanner
          icon={BadgeCheck}
          eyebrow="Nairobi City County Government"
          title={isDirector ? "Director of Mobility — Operator Verification" : "Chief Officer — Final Operator Verification"}
          subtitle={`Welcome back, ${session.name}. ${isDirector ? "You review Operator onboarding applications first." : "You give the final approval once the Director of Mobility has signed off."}`}
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Awaiting your decision"
            value={awaitingYou.length.toString()}
            delta={{ label: "Submitted applications", tone: awaitingYou.length > 0 ? "attention" : "positive" }}
            accent="yellow"
            href="/saccos/verify"
            icon={Clock}
          />
          <KpiCard label="Approved by you" value={approvedByYou.length.toString()} delta={{ label: "All time", tone: "positive" }} accent="green" icon={CheckCircle2} />
          <KpiCard label="Rejected by you" value={rejectedByYou.length.toString()} delta={{ label: "All time", tone: "negative" }} accent="red" icon={XCircle} />
          <KpiCard
            label="Not yet submitted"
            value={notYetSubmitted.length.toString()}
            delta={{ label: "Still filling onboarding wizard", tone: "positive" }}
            icon={FileClock}
          />
        </div>

        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-county-black">Applications Awaiting Your Decision</h3>
            <Link href="/saccos/verify" className="text-xs font-semibold text-county-green hover:underline">
              Full verification hub →
            </Link>
          </div>
          {awaitingYou.length === 0 ? (
            <p className="text-sm text-black/40 py-6 text-center">Nothing waiting on you right now.</p>
          ) : (
            <div className="space-y-2">
              {awaitingYou.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm border-b border-black/5 pb-2 last:border-0">
                  <div>
                    <span className="font-semibold text-county-black">{s.name}</span>
                    <span className="text-xs text-black/50 ml-2">{s.saccoType === "NEW" ? "New Applicant" : "Existing Operator"}</span>
                  </div>
                  <span className="text-xs text-black/50">
                    Submitted {s.applicationSubmittedAt && new Date(s.applicationSubmittedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const [allMatatus, allFines, allActivity, saccos, routes, auditLogs, reports, bookings, telemetry] = await Promise.all([
    getMatatus(),
    getFines(),
    getActivity(),
    getSaccos(),
    getRoutes(),
    can(session.role, "manage_users") ? getAuditLogs(12) : Promise.resolve([]),
    can(session.role, "view_reports") ? getReports() : Promise.resolve([]),
    getMyBookings(),
    getFleetTelemetry(),
  ]);

  const matatus = isSacco ? allMatatus.filter((m) => m.saccoId === session.saccoId) : allMatatus;
  const matatuIds = new Set(matatus.map((m) => m.id));
  const fines = isSacco ? allFines.filter((f) => matatuIds.has(f.matatuId)) : allFines;

  const pendingFines = fines.filter((f) => f.status === "PENDING");
  const pendingAmount = pendingFines.reduce((sum, f) => sum + f.amountKes, 0);
  const flagged = matatus.filter((m) => m.status === "FLAGGED" || m.status === "IMPOUNDED");
  const activeCount = matatus.filter((m) => m.status === "ACTIVE").length;
  const flaggedCount = matatus.filter((m) => m.status === "FLAGGED").length;
  const impoundedCount = matatus.filter((m) => m.status === "IMPOUNDED").length;
  const decommissionedCount = matatus.filter((m) => m.status === "DECOMMISSIONED").length;
  const totalFleet = matatus.length;
  const compliancePct = totalFleet > 0 ? Math.round((activeCount / totalFleet) * 100) : 0;

  const paidKes = fines.filter((f) => f.status === "PAID").reduce((sum, f) => sum + f.amountKes, 0);
  const pendingKes = fines.filter((f) => f.status === "PENDING").reduce((sum, f) => sum + f.amountKes, 0);
  const waivedKes = fines.filter((f) => f.status === "WAIVED").reduce((sum, f) => sum + f.amountKes, 0);
  const disputedKes = fines.filter((f) => f.status === "DISPUTED").reduce((sum, f) => sum + f.amountKes, 0);
  const collectionRate = paidKes + pendingKes > 0 ? Math.round((paidKes / (paidKes + pendingKes)) * 100) : 0;

  const pendingReports = reports.filter((r) => r.status === "PENDING");
  const pendingSaccos = saccos.filter((s) => s.status === "PENDING_VERIFICATION");
  const pendingRenewals = saccos.filter((s) => s.licenseStatus === "RENEWAL_SUBMITTED");
  const pendingApprovals = pendingSaccos.length + pendingRenewals.length;
  const unregisteredCount = saccos.filter((s) => s.status === "UNREGISTERED").length;
  const invitedCount = saccos.filter((s) => s.status === "INVITED").length;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageBanner
        icon={LayoutDashboard}
        eyebrow="Nairobi City County Government"
        title={isSacco ? "Your fleet at a glance" : "Matatu public service managing system"}
        subtitle={`Welcome back, ${session.name}. This view updates itself in real time as bookings, fines, and approvals happen across ${isSacco ? "your fleet" : "Nairobi's matatu sector"}.`}
        action={session.token && <DashboardLiveRefresh token={session.token} />}
      />

      {/* Key metrics — bigger, more decisive scale than generic StatCards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Registered vehicles"
          value={matatus.length.toString()}
          delta={{ label: `${activeCount} in service`, tone: "positive" }}
          href="/matatus"
          icon={Bus}
        />
        <KpiCard
          label="Fleet compliance"
          value={`${compliancePct}%`}
          delta={{
            label: `${flagged.length} flagged or impounded`,
            tone: flagged.length > 0 ? "negative" : "positive",
          }}
          accent="green"
          href="/matatus"
          icon={ShieldCheck}
        />
        <KpiCard
          label="Outstanding fines"
          value={`KES ${(pendingKes / 1000).toFixed(0)}k`}
          delta={{ label: `${pendingFines.length} pending citations`, tone: "negative" }}
          accent="red"
          href="/revenue"
          icon={Banknote}
        />
        {!isSacco && (
          <KpiCard
            label="Awaiting your approval"
            value={pendingApprovals.toString()}
            delta={{
              label: `${pendingSaccos.length} Operators · ${pendingRenewals.length} renewals`,
              tone: pendingApprovals > 0 ? "attention" : "positive",
            }}
            accent="yellow"
            href="/saccos/verify"
            icon={BadgeCheck}
          />
        )}
        {!isSacco && (unregisteredCount > 0 || invitedCount > 0) && (
          <KpiCard
            label="Unregistered operators"
            value={unregisteredCount.toString()}
            delta={{ label: `${invitedCount} invited, awaiting response`, tone: unregisteredCount > 0 ? "attention" : "positive" }}
            accent="red"
            href="/saccos/verify"
            icon={UserX}
          />
        )}
        {isSacco && (
          <KpiCard
            label="Passenger complaints"
            value={reports.filter((r) => r.matatuRegNumber && allMatatus.some((m) => matatuIds.has(m.id) && m.regNumber === r.matatuRegNumber)).length.toString()}
            delta={{ label: `${pendingReports.length} pending review`, tone: "attention" }}
            accent="yellow"
            href="/passengers"
            icon={MessageSquareWarning}
          />
        )}
      </div>

      {/* Row 2: two feature panels + activity rail */}
      <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 grid sm:grid-cols-2 gap-4 md:gap-6">
          <StatusBreakdown
            title="Fleet compliance"
            subtitle="Current status across the registered fleet"
            variant="donut"
            centerMetricLabel="Compliant"
            totalUnitLabel="vehicles"
            headerStat={{ label: "Status", value: "Live", tone: "positive" }}
            segments={[
              { key: "active", label: "Active", color: "#0F5132", value: activeCount },
              { key: "flagged", label: "Flagged", color: "#F5C518", value: flaggedCount },
              { key: "impounded", label: "Impounded", color: "#B4232C", value: impoundedCount },
              { key: "decommissioned", label: "Decommissioned", color: "#3E4A44", value: decommissionedCount },
            ]}
          />
          <StatusBreakdown
            title="Fine revenue"
            subtitle="KES by settlement status"
            variant="bar"
            valueFormat="currency"
            headerStat={{
              label: "Collection rate",
              value: `${collectionRate}%`,
              tone: collectionRate >= 60 ? "positive" : "attention",
            }}
            footerStat={{ label: "Total issued", value: `KES ${(paidKes + pendingKes + disputedKes + waivedKes).toLocaleString()}` }}
            segments={[
              { key: "paid", label: "Paid", color: "#0F5132", value: paidKes },
              { key: "pending", label: "Pending", color: "#F5C518", value: pendingKes },
              { key: "disputed", label: "Disputed", color: "#B4232C", value: disputedKes },
              { key: "waived", label: "Waived", color: "#8A9691", value: waivedKes },
            ]}
          />
          {/* Interactive Recharts time-series (ARCHITECTURE_DECISIONS.md §23) —
              server-pre-aggregated, not raw rows charted client-side. */}
          <TrendChart
            metric="fines"
            title="Fines issued over time"
            countUnit="fines"
            color="#B4232C"
            valueFormat="currency"
          />
        </div>

        <ActivityFeed
          auditLogs={auditLogs}
          reports={reports.slice(0, 4)}
          activity={allActivity.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 6)}
          isVisible={can(session.role, "manage_users")}
        />
      </div>

      {/* Row 3: commuter bookings + live crew/GPS status — previously invisible outside
          the Passenger and Crew dashboards respectively */}
      <div className="grid lg:grid-cols-2 gap-4 md:gap-6">
        <BookingsPanel bookings={isSacco ? bookings.filter((b) => matatuIds.has(b.matatuId)) : bookings} />
        <FleetLiveStatus
          matatus={matatus}
          telemetry={telemetry}
          bookings={isSacco ? bookings.filter((b) => matatuIds.has(b.matatuId)) : bookings}
        />
      </div>

      {/* Row 3b: crowdsourced conditions + official route alerts, the admin
          counterpart to the public login page's Live Updates modal */}
      <LiveConditions />

      {/* Row 4: corridor health, replacing the previous flat status list */}
      <CorridorHealth
        routes={routes}
        matatus={allMatatus}
        fines={allFines}
      />

    </div>
  );
}
