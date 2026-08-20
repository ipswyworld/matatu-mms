import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { readSession } from "@/lib/session";
import { getSaccos, getRoutes, getMatatus, getCrewAssignments } from "@/lib/data";
import SaccoVerificationCard from "@/components/SaccoVerificationCard";
import PageBanner from "@/components/PageBanner";
import LicenseRenewalPanel from "@/components/LicenseRenewalPanel";
import OperatorVerificationBrowser, { OperatorEntry } from "@/components/OperatorVerificationBrowser";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Operator Verification" };

export default async function SaccoVerifyPage() {
  const session = readSession()!;
  const [saccos, routes, matatus, crewAssignments] = await Promise.all([
    getSaccos(),
    getRoutes(),
    getMatatus(),
    getCrewAssignments(),
  ]);

  const routeMap = new Map(routes.map((r) => [r.id, r]));
  const matatuCountMap = new Map<string, number>();
  const matatuToSacco = new Map(matatus.map((m) => [m.id, m.saccoId]));
  matatus.forEach((m) => {
    matatuCountMap.set(m.saccoId, (matatuCountMap.get(m.saccoId) || 0) + 1);
  });
  // CrewAssignment only carries matatuId, not saccoId (crew are tied to a
  // vehicle, not directly to a Sacco) — join through the vehicle to group
  // by Sacco for the per-operator crew roster below.
  const crewBySacco = new Map<string, typeof crewAssignments>();
  crewAssignments.forEach((c) => {
    const saccoId = matatuToSacco.get(c.matatuId);
    if (!saccoId) return;
    const list = crewBySacco.get(saccoId) || [];
    list.push(c);
    crewBySacco.set(saccoId, list);
  });

  const pendingSaccos = saccos.filter((s) => s.status === "PENDING_VERIFICATION");
  const approvedSaccos = saccos.filter((s) => s.status === "ACTIVE" || !s.status);

  return (
    <div className="space-y-6">
      <PageBanner
        icon={BadgeCheck}
        eyebrow="Nairobi City County · Oversight"
        title="Operator Onboarding Verification Hub"
        subtitle="Reviewing mandatory registration documents, bonafide officials, and route licenses for every Operator."
        action={
          <>
            <span className="badge bg-white/10 text-white font-bold">{approvedSaccos.length} Approved</span>
            <span className="badge bg-county-yellow text-yellow-900 font-bold">{pendingSaccos.length} Pending Review</span>
          </>
        }
      />

      <LicenseRenewalPanel saccos={saccos} />

      {/* Verification Applications, grouped by Existing vs. New with a status filter */}
      <div className="space-y-4">
        <h3 className="font-extrabold text-base text-county-black">Operator Applications & Verification Pipeline</h3>

        <OperatorVerificationBrowser
          entries={saccos.map((s): OperatorEntry => {
            const primaryRoute = routeMap.get(s.primaryRouteId || "route-1");
            const vehicleCount = matatuCountMap.get(s.id) || 0;
            const overallStatus: OperatorEntry["overallStatus"] =
              s.chiefOfficerStatus === "APPROVED" ? "ACTIVE" : s.status === "REJECTED" ? "REJECTED" : "PENDING_VERIFICATION";

            return {
              id: s.id,
              saccoType: s.saccoType === "NEW" ? "NEW" : "EXISTING",
              overallStatus,
              node: (
                <SaccoVerificationCard
                  sacco={s}
                  primaryRouteName={primaryRoute?.name || "CBD Corridor"}
                  vehicleCount={vehicleCount}
                  viewerRole={session.role}
                  crew={crewBySacco.get(s.id) || []}
                />
              ),
            };
          })}
        />
      </div>
    </div>
  );
}
