import Link from "next/link";
import { readSession } from "@/lib/session";
import { getSaccos, getRoutes, getMatatus } from "@/lib/data";
import SaccoVerificationCard from "@/components/SaccoVerificationCard";
import PageBanner from "@/components/PageBanner";
import LicenseRenewalPanel from "@/components/LicenseRenewalPanel";

export default async function SaccoVerifyPage() {
  const session = readSession()!;
  const [saccos, routes, matatus] = await Promise.all([
    getSaccos(),
    getRoutes(),
    getMatatus(),
  ]);

  const routeMap = new Map(routes.map((r) => [r.id, r]));
  const matatuCountMap = new Map<string, number>();
  matatus.forEach((m) => {
    matatuCountMap.set(m.saccoId, (matatuCountMap.get(m.saccoId) || 0) + 1);
  });

  const pendingSaccos = saccos.filter((s) => s.status === "PENDING_VERIFICATION");
  const approvedSaccos = saccos.filter((s) => s.status === "ACTIVE" || !s.status);

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Oversight"
        title="Operator Onboarding Verification Hub"
        subtitle="Reviewing mandatory registration documents, bonafide officials, and route licenses for every Sacco."
        action={
          <>
            <span className="badge bg-white/10 text-white font-bold">{approvedSaccos.length} Approved</span>
            <span className="badge bg-county-yellow text-yellow-900 font-bold">{pendingSaccos.length} Pending Review</span>
          </>
        }
      />

      <LicenseRenewalPanel saccos={saccos} />

      {/* Verification Applications List */}
      <div className="space-y-6">
        <h3 className="font-extrabold text-base text-county-black">Sacco Applications & Verification Pipeline</h3>

        {saccos.map((s) => {
          const primaryRoute = routeMap.get(s.primaryRouteId || "route-1");
          const vehicleCount = matatuCountMap.get(s.id) || 0;

          return (
            <SaccoVerificationCard
              key={s.id}
              sacco={s}
              primaryRouteName={primaryRoute?.name || "CBD Corridor"}
              vehicleCount={vehicleCount}
              viewerRole={session.role}
            />
          );
        })}
      </div>
    </div>
  );
}
