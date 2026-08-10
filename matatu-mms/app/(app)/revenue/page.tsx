import Link from "next/link";
import { readSession } from "@/lib/session";
import { getFines, getMatatus, getSaccos } from "@/lib/data";
import { can } from "@/lib/rbac";
import StatCard from "@/components/StatCard";
import { FineStatusPill } from "@/components/StatusPill";
import { disputeFineAction, markFinePaidAction, waiveFineAction } from "@/lib/actions";
import PageBanner from "@/components/PageBanner";
import ExportCsvButton from "@/components/ExportCsvButton";

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: { status?: string; saccoId?: string };
}) {
  const session = readSession()!;
  const isSacco = session.role === "SACCO_OPERATOR";

  // Fetch data in parallel (concurrency)
  const [allMatatus, allFines, saccos] = await Promise.all([
    getMatatus(),
    getFines(),
    getSaccos(),
  ]);

  const matatuMap = new Map(allMatatus.map((m) => [m.id, m]));
  const saccoMap = new Map(saccos.map((s) => [s.id, s]));
  const myMatatuIds = new Set(allMatatus.filter((m) => m.saccoId === session.saccoId).map((m) => m.id));

  // Server-side filtering using query params
  const filterStatus = searchParams.status || "";
  const filterSaccoId = searchParams.saccoId || "";

  const roleFines = allFines.filter((f) => !isSacco || myMatatuIds.has(f.matatuId));

  // Financial Metrics
  const paidKes = roleFines.filter((f) => f.status === "PAID").reduce((sum, f) => sum + f.amountKes, 0);
  const pendingKes = roleFines.filter((f) => f.status === "PENDING").reduce((sum, f) => sum + f.amountKes, 0);
  const disputedKes = roleFines.filter((f) => f.status === "DISPUTED").reduce((sum, f) => sum + f.amountKes, 0);
  const waivedKes = roleFines.filter((f) => f.status === "WAIVED").reduce((sum, f) => sum + f.amountKes, 0);

  const fines = roleFines
    .filter((f) => {
      const m = matatuMap.get(f.matatuId);
      if (!m) return false;

      const matchesSacco = isSacco
        ? m.saccoId === session.saccoId
        : !filterSaccoId || m.saccoId === filterSaccoId;

      const matchesStatus = !filterStatus || f.status === filterStatus;

      return matchesSacco && matchesStatus;
    })
    .slice()
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));

  const canUpdate = can(session.role, "update_fine_status");
  const canDispute = can(session.role, "dispute_fine");

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Revenue"
        title="Revenue & Fines Management Hub"
        subtitle="County treasury fine collection ledger, seasonal Sacco ticket permits, and citation settlements."
        action={
          <>
            <ExportCsvButton
              filename="fines-ledger"
              headers={["Vehicle", "Reason", "Amount (KES)", "Issued", "Due", "Status"]}
              rows={fines.map((f) => [
                matatuMap.get(f.matatuId)?.regNumber || "Unknown",
                f.reason,
                f.amountKes,
                f.issuedAt,
                f.dueDate,
                f.status,
              ])}
            />
            {can(session.role, "issue_fine") && (
              <Link href="/fines/new" className="rounded-lg px-3.5 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors">
                + Issue Citation Fine
              </Link>
            )}
          </>
        }
      />

      {/* Revenue Financial Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Collected Fines Revenue" value={`KES ${paidKes.toLocaleString()}`} hint="Successfully settled fines" />
        <StatCard label="Pending Fines Value" value={`KES ${pendingKes.toLocaleString()}`} accent="red" hint="Outstanding citations due" />
        <StatCard label="Disputed Value" value={`KES ${disputedKes.toLocaleString()}`} hint="Under review by county" />
        <StatCard label="Waived Fines Value" value={`KES ${waivedKes.toLocaleString()}`} hint="Official policy waivers" />
      </div>

      {/* Sacco License Status — read-only reporting. Saccos pay and county approves renewals
          from the Sacco dashboard / Sacco Verification page respectively; admin does not
          process payments here. */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 pb-3">
          <div>
            <h3 className="font-extrabold text-base text-county-black">Sacco Monthly License Status</h3>
            <p className="text-xs text-black/60 mt-0.5">
              Renewal payments are submitted by each Sacco and approved on the{" "}
              <Link href="/saccos/verify" className="font-bold text-county-green hover:underline">Operator Verification</Link> page.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {saccos.map((s) => {
            const style =
              s.licenseStatus === "ACTIVE"
                ? "bg-county-green/5 border-county-green/30"
                : s.licenseStatus === "RENEWAL_SUBMITTED"
                ? "bg-county-blue/5 border-county-blue/30"
                : "bg-amber-500/5 border-amber-500/30";
            const badgeStyle =
              s.licenseStatus === "ACTIVE"
                ? "bg-county-green text-white"
                : s.licenseStatus === "RENEWAL_SUBMITTED"
                ? "bg-county-blue text-white"
                : "bg-amber-500 text-white";
            const label =
              s.licenseStatus === "ACTIVE" ? "ACTIVE" : s.licenseStatus === "RENEWAL_SUBMITTED" ? "PENDING APPROVAL" : "RENEWAL DUE";
            return (
              <div key={s.id} className={`p-4 rounded-xl border space-y-2 ${style}`}>
                <div className="flex justify-between items-start">
                  <div className="font-extrabold text-sm text-county-black">{s.name}</div>
                  <span className={`badge text-[10px] font-extrabold ${badgeStyle}`}>{label}</span>
                </div>
                <div className="text-xs text-black/60">
                  Monthly Fee: <span className="font-bold text-black">KES 15,000</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sacco Revenue Breakdown Grid */}
      <div className="card p-5">
        <h3 className="font-bold text-sm mb-3">Sacco Revenue Performance</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          {saccos.map((s) => {
            const saccoMatatuIds = new Set(allMatatus.filter((m) => m.saccoId === s.id).map((m) => m.id));
            const saccoFines = allFines.filter((f) => saccoMatatuIds.has(f.matatuId));
            const sPaid = saccoFines.filter((f) => f.status === "PAID").reduce((sum, f) => sum + f.amountKes, 0);
            const sPending = saccoFines.filter((f) => f.status === "PENDING").reduce((sum, f) => sum + f.amountKes, 0);

            return (
              <div key={s.id} className="border border-black/10 rounded-lg p-3 bg-black/[0.01]">
                <div className="font-bold text-sm text-county-black">{s.name}</div>
                <div className="text-xs text-black/50 mt-1">{saccoFines.length} citations total</div>
                <div className="flex justify-between items-center text-xs mt-3 pt-2 border-t border-black/5">
                  <span className="text-county-green font-semibold">Paid: KES {sPaid.toLocaleString()}</span>
                  <span className="text-county-red font-semibold">Pending: KES {sPending.toLocaleString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Advanced Search & Filtering form (Zero-JS HTML GET) */}
      <form method="GET" className="flex flex-wrap gap-4 items-end bg-black/5 p-4 rounded-lg">
        <div className="w-56 shrink-0">
          <label className="text-xs font-semibold text-black/50 block mb-1">Filter by Status</label>
          <select
            name="status"
            defaultValue={searchParams.status || ""}
            className="w-full text-sm border border-black/10 rounded px-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
          >
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="PAID">Paid</option>
            <option value="DISPUTED">Disputed</option>
            <option value="WAIVED">Waived</option>
          </select>
        </div>

        {/* Only show Sacco filter to non-Sacco users */}
        {!isSacco && (
          <div className="w-56 shrink-0">
            <label className="text-xs font-semibold text-black/50 block mb-1">Filter by Sacco</label>
            <select
              name="saccoId"
              defaultValue={searchParams.saccoId || ""}
              className="w-full text-sm border border-black/10 rounded px-3 py-1.5 focus:outline-none focus:border-county-green bg-white"
            >
              <option value="">All Saccos</option>
              {saccos.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-2 shrink-0">
          <button type="submit" className="btn-primary !py-1.5">Apply Filters</button>
          <a href="/revenue" className="btn-secondary !py-1.5 text-center">Clear</a>
        </div>
      </form>

      {/* Fines Ledger Table */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Reason</th>
              <th>Amount</th>
              <th>Issued</th>
              <th>Due</th>
              <th>Status</th>
              {(canUpdate || canDispute) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {fines.map((f) => {
              const m = matatuMap.get(f.matatuId);
              return (
                <tr key={f.id}>
                  <td>
                    <Link href={`/matatus/${f.matatuId}`} className="font-semibold text-county-green hover:underline">
                      {m?.regNumber || "Unknown"}
                    </Link>
                  </td>
                  <td>{f.reason}</td>
                  <td className="font-semibold">KES {f.amountKes.toLocaleString()}</td>
                  <td>{f.issuedAt}</td>
                  <td>{f.dueDate}</td>
                  <td><FineStatusPill status={f.status} /></td>
                  {(canUpdate || canDispute) && (
                    <td>
                      <div className="flex gap-2 flex-wrap">
                        {canUpdate && f.status === "PENDING" && (
                          <form action={markFinePaidAction.bind(null, f.id)}>
                            <button className="btn-secondary !px-2 !py-1 text-xs" type="submit">Mark paid</button>
                          </form>
                        )}
                        {canUpdate && f.status !== "WAIVED" && f.status !== "PAID" && (
                          <form action={waiveFineAction.bind(null, f.id)}>
                            <button className="btn-secondary !px-2 !py-1 text-xs" type="submit">Waive</button>
                          </form>
                        )}
                        {canDispute && f.status === "PENDING" && (
                          <form action={disputeFineAction.bind(null, f.id)}>
                            <button className="btn-danger !px-2 !py-1 text-xs" type="submit">Dispute</button>
                          </form>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {fines.length === 0 && (
              <tr><td colSpan={7} className="text-center text-black/40 py-8">No citations matching search criteria.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
