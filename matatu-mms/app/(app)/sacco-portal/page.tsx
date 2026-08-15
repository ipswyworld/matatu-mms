import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getMatatus, getRoutes, getSaccos, getFines, getCrewAssignments } from "@/lib/data";
import StatCard from "@/components/StatCard";
import { MatatuStatusPill } from "@/components/StatusPill";
import OnboardVehicleModal from "@/components/OnboardVehicleModal";
import PageBanner from "@/components/PageBanner";
import SaccoFinesPanel from "@/components/SaccoFinesPanel";
import LicenseRenewalButton from "@/components/LicenseRenewalButton";
import SaccoDocumentUploadRow from "@/components/SaccoDocumentUploadRow";
import SaccoOfficialsForm from "@/components/SaccoOfficialsForm";
import BulkImportVehiclesModal from "@/components/BulkImportVehiclesModal";
import RemoveMatatuButton from "@/components/RemoveMatatuButton";
import IssueCrewCredentialsModal from "@/components/IssueCrewCredentialsModal";
import RevokeCrewAssignmentButton from "@/components/RevokeCrewAssignmentButton";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Operator Dashboard" };

export default async function SaccoPortalPage() {
  const session = readSession()!;
  const [allMatatus, saccos, routes, fines, crewAssignments] = await Promise.all([
    getMatatus(),
    getSaccos(),
    getRoutes(),
    getFines(),
    getCrewAssignments(),
  ]);

  // Backend already scopes SACCO_OPERATOR to their own Sacco; ADMIN/ENFORCEMENT browsing this
  // workspace see the full list and land on the first record as a preview.
  const sacco = saccos.find((s) => s.id === session.saccoId) || saccos[0];

  if (!sacco) {
    return (
      <div className="card p-8 text-center text-sm text-black/60">
        No Operator is registered for this account yet.
      </div>
    );
  }

  // The operator dashboard (fleet onboarding, revenue, routes) stays locked
  // until both verification stages (Director of Mobility, then Chief
  // Officer) approve. The whole "fill in details, then wait" journey lives
  // in one place — the onboarding wizard — rather than being split across
  // two different-looking pages.
  // ADMIN/ENFORCEMENT previewing this workspace bypass the lock for oversight.
  if (session.role === "SACCO_OPERATOR" && sacco.status !== "ACTIVE") {
    redirect("/operator-onboarding/continue");
  }

  const saccoMatatus = allMatatus.filter((m) => m.saccoId === sacco.id);
  const saccoMatatuIds = new Set(saccoMatatus.map((m) => m.id));
  const saccoFines = fines.filter((f) => saccoMatatuIds.has(f.matatuId));
  const saccoCrew = crewAssignments.filter((c) => saccoMatatuIds.has(c.matatuId));
  const routeMap = new Map(routes.map((r) => [r.id, r]));

  const primaryRoute = routeMap.get(sacco.primaryRouteId || "route-1");
  const secondaryRoutes = (sacco.secondaryRouteIds || ["route-2"]).map((id) => routeMap.get(id)).filter(Boolean);

  const pendingVehicles = saccoMatatus.filter((m) => m.status === "REGISTRATION_PENDING");
  const activeVehicles = saccoMatatus.filter((m) => m.status === "ACTIVE");
  const flaggedVehicles = saccoMatatus.filter((m) => m.status === "FLAGGED");

  let officials: import("@/lib/types").SaccoOfficialContact | undefined;
  try {
    officials = sacco.docOfficialsContacts ? JSON.parse(sacco.docOfficialsContacts) : undefined;
  } catch {
    officials = undefined;
  }

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Operator Operations"
        title={`${sacco.name} Portal`}
        titleBadge={
          <span className={`badge font-bold ${sacco.status === "ACTIVE" ? "bg-county-green text-white" : "bg-county-yellow text-yellow-900"}`}>
            {sacco.status === "ACTIVE" ? "County Licensed Operator" : sacco.status}
          </span>
        }
        subtitle="Onboard vehicles, manage route licensing, and keep county verification documents current."
        action={
          <div className="flex gap-2">
            <BulkImportVehiclesModal />
            <OnboardVehicleModal saccoId={sacco.id} routes={routes} />
          </div>
        }
      />

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Registered Fleet" value={saccoMatatus.length} hint="Vehicles under Operator" />
        <StatCard label="Active in Service" value={activeVehicles.length} accent="green" hint="Roadworthy matatus" />
        <StatCard label="Registration Pending" value={pendingVehicles.length} hint="Awaiting county verification" />
        <StatCard label="Flagged / Impounded" value={flaggedVehicles.length} accent="red" hint="Requires resolution" />
      </div>

      {/* Route Licensing & Multi-Route Assignments */}
      <div className="card p-5 space-y-3">
        <div className="flex justify-between items-center border-b border-black/5 pb-2">
          <div>
            <h3 className="font-bold text-sm text-county-black">Operator Route Licensing & Operating Corridors</h3>
            <p className="text-xs text-black/50">Official main route and existing authorized operating corridors for {sacco.name}.</p>
          </div>
          <span className="badge bg-county-blue/10 text-county-blue font-bold">
            Authorized County License
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-4 pt-1">
          {/* Primary Main Route */}
          <div className="p-4 rounded-xl border-2 border-county-green/30 bg-county-green/[0.02] space-y-2">
            <div className="flex justify-between items-center">
              <span className="badge bg-county-green text-white font-extrabold text-[10px]">MAIN OFFICIAL ROUTE</span>
              <span className="font-mono text-xs font-bold text-county-green">Route {primaryRoute?.code || "102"}</span>
            </div>
            <h4 className="font-extrabold text-base text-county-black">{primaryRoute?.name || "CBD - Umoja / Innercore"}</h4>
            <p className="text-xs text-black/60">{primaryRoute?.description || "High volume eastlands commuter corridor."}</p>
          </div>

          {/* Secondary Operating Routes */}
          <div className="p-4 rounded-xl border border-black/10 bg-black/[0.01] space-y-2">
            <div className="flex justify-between items-center">
              <span className="badge bg-county-yellow/20 text-yellow-800 font-bold text-[10px]">AUTHORIZED OPERATING ROUTES</span>
              <span className="text-xs text-black/50">{secondaryRoutes.length} Additional Corridors</span>
            </div>
            <div className="space-y-1.5 pt-1">
              {secondaryRoutes.map((r) => (
                <div key={r?.id || Math.random()} className="flex justify-between items-center text-xs font-semibold border-b border-black/5 pb-1">
                  <span>Route {r?.code} · {r?.name}</span>
                  <span className="badge bg-black/5 text-black/70">ACTIVE PERMIT</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sacco Vehicles & Onboarding Registry Table */}
      <div className="card p-5 space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-bold text-sm text-county-black">Operator Vehicle Onboarding Registry</h3>
            <p className="text-xs text-black/50">All matatus onboarded under {sacco.name} with terminal stage assignments.</p>
          </div>
          <span className="text-xs font-bold text-black/50">
            {saccoMatatus.length} Vehicles Registered
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
              <tr>
                <th className="p-2.5">Plate Number</th>
                <th className="p-2.5">Terminal & Stage Segment</th>
                <th className="p-2.5">Capacity</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5">Driver</th>
                <th className="p-2.5">Conductor</th>
                <th className="p-2.5">Date Onboarded</th>
                <th className="p-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {saccoMatatus.map((m) => {
                const defaultSegment = `${sacco.name}: CBD-Umoja Terminal: Tusker Stage`;
                return (
                  <tr key={m.id} className="hover:bg-black/[0.02]">
                    <td className="p-2.5 font-bold font-mono text-county-black">
                      {m.regNumber}
                    </td>
                    <td className="p-2.5">
                      <span className="bg-black/5 px-2 py-1 rounded border border-black/5 font-semibold text-black/70">
                        {m.terminalSegment || defaultSegment}
                      </span>
                    </td>
                    <td className="p-2.5 font-bold">{m.capacity} Seats</td>
                    <td className="p-2.5">
                      <MatatuStatusPill status={m.status} />
                    </td>
                    <td className="p-2.5">
                      {m.driverName ? (
                        <div>
                          <div className="font-semibold">{m.driverName}</div>
                          <div className="text-[10px] text-black/40 font-mono">{m.driverLicense} · {m.driverPhone}</div>
                        </div>
                      ) : (
                        <span className="text-black/30 italic">Not on file</span>
                      )}
                    </td>
                    <td className="p-2.5">
                      {m.conductorName ? (
                        <div>
                          <div className="font-semibold">{m.conductorName}</div>
                          <div className="text-[10px] text-black/40 font-mono">{m.conductorLicense} · {m.conductorPhone}</div>
                        </div>
                      ) : (
                        <span className="text-black/30 italic">Not on file</span>
                      )}
                    </td>
                    <td className="p-2.5 text-black/50 font-mono">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-2.5">
                      <RemoveMatatuButton matatuId={m.id} regNumber={m.regNumber} />
                    </td>
                  </tr>
                );
              })}
              {saccoMatatus.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-black/40">
                    No vehicles onboarded yet under {sacco.name}. Click &quot;+ Onboard New Vehicle&quot; to add your first matatu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Crew Accounts — real login-linked driver/conductor accounts, distinct
          from the plain-text driver/conductor fields in the registry table
          above. Operator issues a login the moment they assign someone to a
          vehicle (ARCHITECTURE_DECISIONS.md §29.1); crew never self-register. */}
      <div className="card p-5 space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-bold text-sm text-county-black">Crew Accounts</h3>
            <p className="text-xs text-black/50">Login credentials issued to drivers and conductors, tied to a vehicle.</p>
          </div>
          <IssueCrewCredentialsModal matatus={saccoMatatus} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
              <tr>
                <th className="p-2.5">Name</th>
                <th className="p-2.5">Login Email</th>
                <th className="p-2.5">Role</th>
                <th className="p-2.5">Vehicle</th>
                <th className="p-2.5">Assigned</th>
                <th className="p-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {saccoCrew.map((c) => (
                <tr key={c.id} className="hover:bg-black/[0.02]">
                  <td className="p-2.5 font-semibold">{c.userName}</td>
                  <td className="p-2.5 font-mono text-black/60">{c.userEmail}</td>
                  <td className="p-2.5">
                    <span className="badge bg-black/5 text-black/70 font-bold">{c.crewRole}</span>
                  </td>
                  <td className="p-2.5 font-bold font-mono">{c.matatuRegNumber}</td>
                  <td className="p-2.5 text-black/50 font-mono">{new Date(c.assignedAt).toLocaleDateString()}</td>
                  <td className="p-2.5">
                    <RevokeCrewAssignmentButton assignmentId={c.id} />
                  </td>
                </tr>
              ))}
              {saccoCrew.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-black/40">
                    No crew logins issued yet. Click &quot;+ Issue Crew Login&quot; to assign a driver or conductor.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SaccoFinesPanel fines={saccoFines} />

      {/* County Verification Documents & Bonafide Contacts — real uploaded data,
          re-uploadable in place (e.g. a Tax Compliance Certificate renewal). */}
      <div className="card p-5 space-y-4">
        <div className="flex justify-between items-center border-b border-black/5 pb-2">
          <div>
            <h3 className="font-bold text-sm text-county-black">County Verification Documents & Bonafide Contacts</h3>
            <p className="text-xs text-black/50">Mandatory onboarding files on record for your Operator County Operating License.</p>
          </div>
          <span className="badge bg-county-green/10 text-county-green font-bold">
            VERIFIED & APPROVED
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2.5">
            <h4 className="text-xs font-extrabold text-black/70 uppercase tracking-wider">Submitted Mandatory Documents</h4>
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="registrationCert" label="1. Registration Certificate" currentPath={sacco.docRegistrationCert} />
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="roadServiceLicense" label="2. Road Service License (RSL)" currentPath={sacco.docRoadServiceLicense} />
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="countyPermit" label="3. Permit from County" currentPath={sacco.docCountyPermit} />
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="singleBusinessPermit" label="4. Single Business Permit (SBP)" currentPath={sacco.docSingleBusinessPermit} />
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="taxComplianceCert" label="5. Tax Compliance Certificate" currentPath={sacco.docTaxComplianceCert} />
            {sacco.saccoType === "NEW" && (
              <SaccoDocumentUploadRow saccoId={sacco.id} docType="letterNoObjection" label="6. Letter of No Objection" currentPath={sacco.docLetterNoObjection} />
            )}
          </div>

          <div className="space-y-2.5">
            <h4 className="text-xs font-extrabold text-black/70 uppercase tracking-wider">Bonafide Officials Contacts</h4>
            <SaccoOfficialsForm saccoId={sacco.id} officials={officials} />
            <LicenseRenewalButton saccoId={sacco.id} licenseStatus={sacco.licenseStatus} />
          </div>
        </div>
      </div>
    </div>
  );
}
