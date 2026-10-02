import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, Coins, AlertCircle, Scale, CircleSlash, Plus } from "lucide-react";
import { readSession } from "@/lib/session";
import { getFines, getMatatus, getSaccos } from "@/lib/data";
import { can } from "@/lib/rbac";
import StatCard from "@/components/StatCard";
import PageBanner from "@/components/PageBanner";
import OperatorRevenueFilter from "@/components/OperatorRevenueFilter";
import RevenueBarChart from "@/components/RevenueBarChart";
import FinesFilterTable from "@/components/FinesFilterTable";

export const metadata: Metadata = { title: "Revenue & Fines" };

export default async function RevenuePage() {
  const session = readSession()!;
  const isSacco = session.role === "SACCO_OPERATOR";

  // Fetch data in parallel (concurrency)
  const [allMatatus, allFines, saccos] = await Promise.all([
    getMatatus(),
    getFines(),
    getSaccos(),
  ]);

  const matatuMap = new Map(allMatatus.map((m) => [m.id, m]));
  const myMatatuIds = new Set(allMatatus.filter((m) => m.saccoId === session.saccoId).map((m) => m.id));

  // Role-scoped once, server-side: an operator's fine data never leaves the
  // server for other operators' vehicles. Status/operator filtering below
  // that is instant client-side filtering over this already-scoped set.
  const roleFines = allFines.filter((f) => !isSacco || myMatatuIds.has(f.matatuId));
  const fines = roleFines.filter((f) => matatuMap.has(f.matatuId));

  // Financial Metrics
  const paidKes = roleFines.filter((f) => f.status === "PAID").reduce((sum, f) => sum + f.amountKes, 0);
  const pendingKes = roleFines.filter((f) => f.status === "PENDING").reduce((sum, f) => sum + f.amountKes, 0);
  const disputedKes = roleFines.filter((f) => f.status === "DISPUTED").reduce((sum, f) => sum + f.amountKes, 0);
  const waivedKes = roleFines.filter((f) => f.status === "WAIVED").reduce((sum, f) => sum + f.amountKes, 0);

  const canUpdate = can(session.role, "update_fine_status");
  const canDispute = can(session.role, "dispute_fine");

  return (
    <div className="space-y-6">
      <PageBanner
        icon={Wallet}
        eyebrow="Nairobi City County · Revenue"
        title="Revenue & Fines Management Hub"
        subtitle="County treasury fine collection ledger, seasonal Operator ticket permits, and citation settlements."
        action={
          <>
            {can(session.role, "issue_fine") && (
              <Link href="/fines/new" className="rounded-lg px-3.5 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors flex items-center gap-1.5">
                <Plus size={14} strokeWidth={2.5} />
                Issue Citation Fine
              </Link>
            )}
          </>
        }
      />

      {/* Revenue Financial Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Collected Fines Revenue" value={`KES ${paidKes.toLocaleString()}`} hint="Successfully settled fines" icon={Coins} />
        <StatCard label="Pending Fines Value" value={`KES ${pendingKes.toLocaleString()}`} accent="red" hint="Outstanding citations due" icon={AlertCircle} />
        <StatCard label="Disputed Value" value={`KES ${disputedKes.toLocaleString()}`} hint="Under review by county" icon={Scale} />
        <StatCard label="Waived Fines Value" value={`KES ${waivedKes.toLocaleString()}`} hint="Official policy waivers" icon={CircleSlash} />
      </div>

      <RevenueBarChart
        title="Fine Revenue by Settlement Status"
        data={[
          { label: "Paid", value: paidKes, colorClass: "bg-county-green" },
          { label: "Pending", value: pendingKes, colorClass: "bg-county-red" },
          { label: "Disputed", value: disputedKes, colorClass: "bg-amber-500" },
          { label: "Waived", value: waivedKes, colorClass: "bg-black/30" },
        ]}
      />

      {/* Sacco license + revenue — filter-by-operator instead of a long scrolling
          list. Saccos pay and county approves renewals from the Sacco dashboard /
          Sacco Verification page respectively; admin does not process payments here. */}
      {!isSacco && (
        <OperatorRevenueFilter
          rows={saccos.map((s) => {
            const saccoMatatuIds = new Set(allMatatus.filter((m) => m.saccoId === s.id).map((m) => m.id));
            const saccoFines = allFines.filter((f) => saccoMatatuIds.has(f.matatuId));
            return {
              id: s.id,
              name: s.name,
              licenseStatus: s.licenseStatus,
              citationCount: saccoFines.length,
              paidKes: saccoFines.filter((f) => f.status === "PAID").reduce((sum, f) => sum + f.amountKes, 0),
              pendingKes: saccoFines.filter((f) => f.status === "PENDING").reduce((sum, f) => sum + f.amountKes, 0),
            };
          })}
        />
      )}

      <FinesFilterTable
        fines={fines}
        matatus={allMatatus}
        saccos={saccos}
        isSacco={isSacco}
        canUpdate={canUpdate}
        canDispute={canDispute}
      />
    </div>
  );
}
