import type { Metadata } from "next";
import { Bus, ShieldCheck, Banknote, BadgeCheck, MessageSquareWarning, Clock, CheckCircle2, XCircle, FileClock, LayoutDashboard, UserX, TrendingUp } from "lucide-react";
import { readSession } from "@/lib/session";
import { getFines, getMatatus, getActivity, getRoutes, getRouteNetwork, getSaccos, getAuditLogs, getReports, getMyBookings, getFleetTelemetry, getTimeseries } from "@/lib/data";
import { canAny, ADMIN_TIER_ROLES } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";

export const metadata: Metadata = { title: "Overview" };
import StatusBreakdown from "@/components/widgets/StatusBreakdown";
import TrendChart from "@/components/widgets/TrendChart";
import WorkQueueList, { WorkQueueItem } from "@/components/widgets/WorkQueueList";
import KpiCard from "@/components/dashboard/KpiCard";
import ActivityFeed from "@/components/dashboard/ActivityFeed";
import RouteNetworkMap from "@/components/dashboard/RouteNetworkMap";
import BookingsPanel from "@/components/dashboard/BookingsPanel";
import FleetLiveStatus from "@/components/dashboard/FleetLiveStatus";
import DashboardLiveRefresh from "@/components/DashboardLiveRefresh";
import LiveConditions from "@/components/dashboard/LiveConditions";

// "3d 4h", "6h", "40m" — a submitted-at timestamp compared to now. Used for
// WorkQueueList's ageLabel (oldest-first work queues) across persona
// dashboards, not just this one.
function ageLabel(fromIso?: string): string | undefined {
  if (!fromIso) return undefined;
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 0) return undefined;
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

function averageDays(msValues: number[]): string {
  if (msValues.length === 0) return "—";
  const avgMs = msValues.reduce((sum, v) => sum + v, 0) / msValues.length;
  const days = avgMs / 86_400_000;
  return days < 1 ? `${Math.round(days * 24)}h` : `${days.toFixed(1)}d`;
}

export default async function DashboardPage() {
  const session = readSession()!;
  const isSacco = session.role === "SACCO_OPERATOR";
  // Full effective role set (primary + any additional predefined roles a
  // Super Admin has granted, see EditUserModal). An admin-tier role in that
  // set — whether primary or additional — bumps a user out of the narrower
  // Director/Chief-Officer or Viewer templates below into the full
  // dashboard, since admin-tier is a strict superset of either. This is a
  // deliberate interim heuristic, not the end state: a real permission-
  // driven dashboard (sections gated individually, not "admin-tier gets
  // everything") is real, separate, larger work left for later.
  const roles = [session.role, ...(session.additionalRoles ?? [])];
  const hasAdminTier = roles.some((r) => ADMIN_TIER_ROLES.includes(r));

  // --- Director of Mobility / Chief Officer: a work-queue dashboard, not
  // a briefing — their whole job on this system is "decide the next
  // application," so the queue itself (oldest first, with SLA aging) is
  // the primary surface, not a supporting panel. Built on WorkQueueList
  // per ADMIN_DASHBOARD_AUDIT §5.1/§6.1. ---
  if (!hasAdminTier && (session.role === "DIRECTOR_MOBILITY" || session.role === "CHIEF_OFFICER")) {
    const saccos = await getSaccos();
    const isDirector = session.role === "DIRECTOR_MOBILITY";
    const stageField = isDirector ? "directorMobilityStatus" : "chiefOfficerStatus";
    const decidedAtField = isDirector ? "directorMobilityDecidedAt" : "chiefOfficerDecidedAt";

    const awaitingYou = saccos
      .filter((s) => {
        if (!s.applicationSubmittedAt) return false;
        if (isDirector) return s[stageField] === "PENDING";
        return s.directorMobilityStatus === "APPROVED" && s[stageField] === "PENDING";
      })
      .sort((a, b) => new Date(a.applicationSubmittedAt!).getTime() - new Date(b.applicationSubmittedAt!).getTime());
    const approvedByYou = saccos.filter((s) => s[stageField] === "APPROVED");
    const rejectedByYou = saccos.filter((s) => s[stageField] === "REJECTED");
    const notYetSubmitted = saccos.filter((s) => !s.applicationSubmittedAt && s.status === "PENDING_VERIFICATION");
    const decided = saccos.filter((s) => (s[stageField] === "APPROVED" || s[stageField] === "REJECTED") && s[decidedAtField] && s.applicationSubmittedAt);
    const decisionTimesMs = decided.map((s) => new Date(s[decidedAtField]!).getTime() - new Date(s.applicationSubmittedAt!).getTime());
    const oldestWaitingHours = awaitingYou[0]?.applicationSubmittedAt
      ? (Date.now() - new Date(awaitingYou[0].applicationSubmittedAt).getTime()) / 3_600_000
      : 0;

    const queueItems: WorkQueueItem[] = awaitingYou.map((s) => ({
      id: s.id,
      label: s.name,
      detail: s.saccoType === "NEW" ? "New Applicant" : "Existing Operator",
      ageLabel: ageLabel(s.applicationSubmittedAt),
      href: "/saccos/verify",
    }));

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
            delta={{
              label: oldestWaitingHours > 48 ? `Oldest waiting ${Math.round(oldestWaitingHours / 24)}d — SLA risk` : "Submitted applications",
              tone: oldestWaitingHours > 48 ? "negative" : awaitingYou.length > 0 ? "attention" : "positive",
            }}
            accent="yellow"
            href="/saccos/verify"
            icon={Clock}
          />
          <KpiCard label="Approved by you" value={approvedByYou.length.toString()} delta={{ label: "All time", tone: "positive" }} accent="green" icon={CheckCircle2} />
          <KpiCard label="Rejected by you" value={rejectedByYou.length.toString()} delta={{ label: "All time", tone: "negative" }} accent="red" icon={XCircle} />
          <KpiCard
            label="Avg. time to decision"
            value={averageDays(decisionTimesMs)}
            delta={{ label: `${decided.length} decided, all time`, tone: "positive" }}
            icon={FileClock}
          />
        </div>

        <WorkQueueList
          title="Applications Awaiting Your Decision"
          subtitle="Oldest first — same order the SLA clock would flag."
          items={queueItems}
          viewAllHref="/saccos/verify"
          viewAllLabel="Full verification hub"
          emptyLabel="Nothing waiting on you right now."
          maxVisible={8}
        />

        {notYetSubmitted.length > 0 && (
          <p className="text-xs text-black/40 text-center">
            {notYetSubmitted.length} more operator{notYetSubmitted.length !== 1 ? "s" : ""} still filling out the onboarding wizard — not yet submitted, so not in your queue.
          </p>
        )}
      </div>
    );
  }

  // --- Viewer / Executive: read-only oversight. Deliberately no
  // per-item action queues here (Viewer can't act on any of them) — this
  // is a briefing, not a work list. Was previously routed through the
  // operational admin dashboard below, which showed "Awaiting your
  // approval" cards a Viewer has no permission to act on. ---
  if (!hasAdminTier && session.role === "VIEWER") {
    const [viewerMatatus, viewerFines, viewerSaccos, viewerRoutes, viewerRouteNetwork] = await Promise.all([
      getMatatus(),
      getFines(),
      getSaccos(),
      getRoutes(),
      getRouteNetwork(),
    ]);
    const activeV = viewerMatatus.filter((m) => m.status === "ACTIVE").length;
    const flaggedV = viewerMatatus.filter((m) => m.status === "FLAGGED").length;
    const impoundedV = viewerMatatus.filter((m) => m.status === "IMPOUNDED").length;
    const decommissionedV = viewerMatatus.filter((m) => m.status === "DECOMMISSIONED").length;
    const compliancePctV = viewerMatatus.length > 0 ? Math.round((activeV / viewerMatatus.length) * 100) : 0;
    const paidV = viewerFines.filter((f) => f.status === "PAID").reduce((s, f) => s + f.amountKes, 0);
    const pendingV = viewerFines.filter((f) => f.status === "PENDING").reduce((s, f) => s + f.amountKes, 0);
    const disputedV = viewerFines.filter((f) => f.status === "DISPUTED").reduce((s, f) => s + f.amountKes, 0);
    const waivedV = viewerFines.filter((f) => f.status === "WAIVED").reduce((s, f) => s + f.amountKes, 0);
    const collectionRateV = paidV + pendingV > 0 ? Math.round((paidV / (paidV + pendingV)) * 100) : 0;
    const activeOperators = viewerSaccos.filter((s) => s.status === "ACTIVE").length;

    return (
      <div className="space-y-4 md:space-y-6">
        <PageBanner
          icon={TrendingUp}
          eyebrow="Nairobi City County Government"
          title="Executive Briefing"
          subtitle={`Welcome back, ${session.name}. Read-only oversight across Nairobi's matatu sector — no action items, just the current state and trend.`}
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Registered vehicles" value={viewerMatatus.length.toString()} delta={{ label: `${activeV} in service`, tone: "positive" }} href="/matatus" icon={Bus} />
          <KpiCard
            label="Fleet compliance"
            value={`${compliancePctV}%`}
            delta={{ label: `${flaggedV + impoundedV} flagged or impounded`, tone: flaggedV + impoundedV > 0 ? "negative" : "positive" }}
            accent="green"
            href="/matatus"
            icon={ShieldCheck}
          />
          <KpiCard label="Revenue collected" value={`KES ${(paidV / 1000).toFixed(0)}k`} delta={{ label: `${collectionRateV}% collection rate`, tone: "positive" }} href="/revenue" icon={Banknote} />
          <KpiCard label="Active operators" value={activeOperators.toString()} delta={{ label: `${viewerSaccos.length} total on record`, tone: "positive" }} href="/saccos/verify" icon={BadgeCheck} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4 md:gap-6">
          <StatusBreakdown
            title="Fleet compliance"
            subtitle="Current status across the registered fleet"
            variant="donut"
            centerMetricLabel="Compliant"
            totalUnitLabel="vehicles"
            segments={[
              { key: "active", label: "Active", color: "#0F5132", value: activeV },
              { key: "flagged", label: "Flagged", color: "#F5C518", value: flaggedV },
              { key: "impounded", label: "Impounded", color: "#B4232C", value: impoundedV },
              { key: "decommissioned", label: "Decommissioned", color: "#3E4A44", value: decommissionedV },
            ]}
          />
          <StatusBreakdown
            title="Fine revenue"
            subtitle="KES by settlement status"
            variant="bar"
            valueFormat="currency"
            headerStat={{ label: "Collection rate", value: `${collectionRateV}%`, tone: collectionRateV >= 60 ? "positive" : "attention" }}
            footerStat={{ label: "Total issued", value: `KES ${(paidV + pendingV + disputedV + waivedV).toLocaleString()}` }}
            segments={[
              { key: "paid", label: "Paid", color: "#0F5132", value: paidV },
              { key: "pending", label: "Pending", color: "#F5C518", value: pendingV },
              { key: "disputed", label: "Disputed", color: "#B4232C", value: disputedV },
              { key: "waived", label: "Waived", color: "#8A9691", value: waivedV },
            ]}
          />
          <TrendChart metric="fines" title="Fines issued over time" countUnit="fines" color="#B4232C" valueFormat="currency" />
          <TrendChart metric="bookings" title="Passenger demand over time" countUnit="bookings" color="#0F5132" />
        </div>

        <RouteNetworkMap geometry={viewerRouteNetwork} routes={viewerRoutes} matatus={viewerMatatus} fines={viewerFines} />
      </div>
    );
  }

  const [allMatatus, allFines, allActivity, saccos, routes, routeNetwork, auditLogs, reports, bookings, telemetry, finesTrend] = await Promise.all([
    getMatatus(),
    getFines(),
    getActivity(),
    getSaccos(),
    getRoutes(),
    getRouteNetwork(),
    canAny(roles, "manage_users") ? getAuditLogs(12) : Promise.resolve([]),
    canAny(roles, "view_reports") ? getReports() : Promise.resolve([]),
    getMyBookings(),
    getFleetTelemetry(),
    getTimeseries("fines", 14, "day"),
  ]);
  const finesSparkline = finesTrend.points.map((p) => p.value);

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

  // Hero work-queue (ADMIN_DASHBOARD_AUDIT §6's progressive-disclosure
  // recommendation) — the same pendingSaccos/pendingRenewals counted by
  // the "Awaiting your approval" KPI below, surfaced as an actual
  // actionable list before the KPI grid instead of only as one number.
  // Sacco Operators don't approve anything here (isSacco already hides
  // that KPI), so no queue for them either.
  const approvalQueueItems: WorkQueueItem[] = !isSacco
    ? [
        ...pendingSaccos
          .slice()
          .sort((a, b) => new Date(a.applicationSubmittedAt || 0).getTime() - new Date(b.applicationSubmittedAt || 0).getTime())
          .map((s) => ({
            id: s.id,
            label: s.name,
            detail: s.saccoType === "NEW" ? "New Application" : "Existing Operator",
            ageLabel: ageLabel(s.applicationSubmittedAt),
            href: "/saccos/verify",
          })),
        ...pendingRenewals.map((s) => ({
          id: `renewal-${s.id}`,
          label: s.name,
          detail: "License Renewal",
          href: "/saccos/verify",
        })),
      ]
    : [];

  return (
    <div className="space-y-4 md:space-y-6">
      <PageBanner
        icon={LayoutDashboard}
        eyebrow="Nairobi City County Government"
        title={isSacco ? "Your fleet at a glance" : "Matatu public service managing system"}
        subtitle={`Welcome back, ${session.name}. This view updates itself in real time as bookings, fines, and approvals happen across ${isSacco ? "your fleet" : "Nairobi's matatu sector"}.`}
        action={session.token && <DashboardLiveRefresh token={session.token} />}
      />

      {!isSacco && (
        <WorkQueueList
          title="Operator Applications Awaiting Decision"
          subtitle="New applications and renewals awaiting county approval — oldest first."
          items={approvalQueueItems}
          viewAllHref="/saccos/verify"
          viewAllLabel="Full verification hub"
          emptyLabel="Nothing waiting on approval right now."
          maxVisible={5}
        />
      )}

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
          sparkline={finesSparkline}
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
          isVisible={canAny(roles, "manage_users")}
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

      {/* Row 4: route network map, replacing the previous flat corridor-health list */}
      <RouteNetworkMap
        geometry={routeNetwork}
        routes={routes}
        matatus={allMatatus}
        fines={allFines}
      />

    </div>
  );
}
