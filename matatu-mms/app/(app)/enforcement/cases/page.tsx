import { FolderOpen } from "lucide-react";
import { readSession } from "@/lib/session";
import { getEnforcementCases } from "@/lib/data";
import { can } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";
import EnforcementCaseActions from "@/components/EnforcementCaseActions";
import EvidenceGallery from "@/components/EvidenceGallery";

const STATUS_STYLES: Record<string, string> = {
  ARRESTED: "bg-amber-100 text-amber-700",
  PAID: "bg-county-blue/10 text-county-blue",
  RELEASED: "bg-county-green/10 text-county-green",
  DISPUTED: "bg-county-red/10 text-county-red",
  WAIVED: "bg-black/10 text-black/60",
  UNDER_REVIEW: "bg-county-yellow/20 text-county-yellow-dark",
  RESOLVED_UPHELD: "bg-county-yellow/20 text-county-yellow-dark",
  RESOLVED_PARTIAL: "bg-county-yellow/20 text-county-yellow-dark",
  RESOLVED_OVERTURNED: "bg-county-green/10 text-county-green",
};

export default async function EnforcementCasesPage() {
  const session = readSession()!;
  const cases = await getEnforcementCases();
  const canDecide = can(session.role, "decide_enforcement_case");

  // Open = anything still needing action, which includes a dispute under
  // review and an upheld/partially-relieved fine (both still payable).
  // Previously UNDER_REVIEW and every RESOLVED_* case matched neither
  // list and vanished from this page altogether.
  const OPEN_STATUSES = ["ARRESTED", "PAID", "DISPUTED", "UNDER_REVIEW", "RESOLVED_UPHELD", "RESOLVED_PARTIAL"];
  const openCases = cases.filter((c) => OPEN_STATUSES.includes(c.status));
  const closedCases = cases.filter((c) => !OPEN_STATUSES.includes(c.status));

  return (
    <div className="space-y-6">
      <PageBanner
        icon={FolderOpen}
        eyebrow="Nairobi City County · Enforcement"
        title="Case Queue"
        subtitle={
          canDecide
            ? "Cases awaiting payment confirmation and release. Disputes and waivers require a recorded reason."
            : "Enforcement case pipeline — arrest through release."
        }
      />

      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-county-black">Open Cases</h3>
          <span className="badge bg-county-yellow/20 text-yellow-800 font-bold">{openCases.length} awaiting action</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
              <tr>
                <th className="p-2.5">Case Reference</th>
                <th className="p-2.5">Plate</th>
                <th className="p-2.5">Offence</th>
                <th className="p-2.5">Action Taken</th>
                <th className="p-2.5">Fine (KES)</th>
                <th className="p-2.5">Arresting Officer</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5">Photos</th>
                {canDecide && <th className="p-2.5">Decision</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {openCases.map((c) => (
                <tr key={c.id} className="hover:bg-black/[0.02] align-top">
                  <td className="p-2.5 font-mono font-bold text-county-black">{c.caseReference}</td>
                  <td className="p-2.5 font-mono font-bold">{c.regNumber}</td>
                  <td className="p-2.5">
                    <div className="font-semibold">{c.offenceName}</div>
                    {c.offenceDescription && <div className="text-[10px] text-black/50">{c.offenceDescription}</div>}
                  </td>
                  <td className="p-2.5">{c.actionTaken.replace(/_/g, " ")}</td>
                  <td className="p-2.5 font-bold">{c.fineAmountKes.toLocaleString()}</td>
                  <td className="p-2.5">{c.arrestingOfficerName}</td>
                  <td className="p-2.5">
                    <span className={`badge font-bold ${STATUS_STYLES[c.status]}`}>{c.status}</span>
                  </td>
                  <td className="p-2.5">
                    <EvidenceGallery
                      photos={c.photoPaths}
                      label={`${c.caseReference} — ${c.regNumber}`}
                    />
                  </td>
                  {canDecide && (
                    <td className="p-2.5">
                      <EnforcementCaseActions caseId={c.id} status={c.status} />
                    </td>
                  )}
                </tr>
              ))}
              {openCases.length === 0 && (
                <tr>
                  <td colSpan={canDecide ? 9 : 8} className="text-center py-6 text-black/40">
                    No open cases right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm text-county-black">Closed Cases</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
              <tr>
                <th className="p-2.5">Case Reference</th>
                <th className="p-2.5">Plate</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5">Releasing Officer</th>
                <th className="p-2.5">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {closedCases.map((c) => (
                <tr key={c.id} className="hover:bg-black/[0.02]">
                  <td className="p-2.5 font-mono font-bold text-county-black">{c.caseReference}</td>
                  <td className="p-2.5 font-mono font-bold">{c.regNumber}</td>
                  <td className="p-2.5"><span className={`badge font-bold ${STATUS_STYLES[c.status]}`}>{c.status}</span></td>
                  <td className="p-2.5">{c.releasingOfficerName || "—"}</td>
                  <td className="p-2.5 text-black/60">
                    {c.status === "DISPUTED" && c.disputeReason}
                    {c.status === "WAIVED" && `${c.waivedReason} (authorized by ${c.waivedAuthorizedBy})`}
                  </td>
                </tr>
              ))}
              {closedCases.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-black/40">No closed cases yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
