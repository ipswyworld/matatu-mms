import { Gavel } from "lucide-react";
import { readSession } from "@/lib/session";
import { getEnforcementCases } from "@/lib/data";
import PageBanner from "@/components/PageBanner";
import DisputeCaseActions from "@/components/DisputeCaseActions";

const STATUS_STYLES: Record<string, string> = {
  DISPUTED: "bg-county-red/10 text-county-red",
  UNDER_REVIEW: "bg-county-yellow/20 text-yellow-800",
  RESOLVED_UPHELD: "bg-county-red/10 text-county-red",
  RESOLVED_OVERTURNED: "bg-county-green/10 text-county-green",
  RESOLVED_PARTIAL: "bg-county-blue/10 text-county-blue",
};

export default async function DisputeReviewsPage() {
  const session = readSession()!;
  const cases = await getEnforcementCases();

  const openDisputes = cases.filter((c) => c.status === "DISPUTED" || c.status === "UNDER_REVIEW");
  const resolvedDisputes = cases
    .filter((c) => c.status.startsWith("RESOLVED_"))
    .sort((a, b) => new Date(b.resolvedAt || 0).getTime() - new Date(a.resolvedAt || 0).getTime());

  return (
    <div className="space-y-6">
      <PageBanner
        icon={Gavel}
        eyebrow="Nairobi City County · Enforcement"
        title="Dispute Reviews"
        subtitle="Fines disputed by offenders, awaiting or under county review. Assign yourself a case, note your findings, then record a final decision."
      />

      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-county-black">Open Disputes</h3>
          <span className="badge bg-county-yellow/20 text-yellow-800 font-bold">{openDisputes.length} awaiting review</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
              <tr>
                <th className="p-2.5">Case Reference</th>
                <th className="p-2.5">Plate</th>
                <th className="p-2.5">Offence</th>
                <th className="p-2.5">Fine (KES)</th>
                <th className="p-2.5">Dispute Reason</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {openDisputes.map((c) => (
                <tr key={c.id} className="hover:bg-black/[0.02] align-top">
                  <td className="p-2.5 font-mono font-bold text-county-black">{c.caseReference}</td>
                  <td className="p-2.5 font-mono font-bold">{c.regNumber}</td>
                  <td className="p-2.5">
                    <div className="font-semibold">{c.offenceName}</div>
                    <div className="text-[10px] text-black/50">KES {c.fineAmountKes.toLocaleString()} · {c.actionTaken.replace(/_/g, " ")}</div>
                  </td>
                  <td className="p-2.5 font-bold">{c.fineAmountKes.toLocaleString()}</td>
                  <td className="p-2.5 text-black/60 max-w-[220px]">{c.disputeReason}</td>
                  <td className="p-2.5">
                    <span className={`badge font-bold ${STATUS_STYLES[c.status]}`}>{c.status.replace(/_/g, " ")}</span>
                  </td>
                  <td className="p-2.5">
                    <DisputeCaseActions
                      caseId={c.id}
                      status={c.status}
                      reviewerId={c.reviewerId}
                      reviewerName={c.reviewerName}
                      reviewNotes={c.reviewNotes}
                      currentUserId={session.userId}
                    />
                  </td>
                </tr>
              ))}
              {openDisputes.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-black/40">No open disputes right now.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm text-county-black">Resolved Disputes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
              <tr>
                <th className="p-2.5">Case Reference</th>
                <th className="p-2.5">Plate</th>
                <th className="p-2.5">Outcome</th>
                <th className="p-2.5">Decided By</th>
                <th className="p-2.5">Decision Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {resolvedDisputes.map((c) => (
                <tr key={c.id} className="hover:bg-black/[0.02]">
                  <td className="p-2.5 font-mono font-bold text-county-black">{c.caseReference}</td>
                  <td className="p-2.5 font-mono font-bold">{c.regNumber}</td>
                  <td className="p-2.5"><span className={`badge font-bold ${STATUS_STYLES[c.status]}`}>{c.status.replace(/_/g, " ")}</span></td>
                  <td className="p-2.5">{c.resolvedByName || "—"}</td>
                  <td className="p-2.5 text-black/60">{c.resolutionReason}</td>
                </tr>
              ))}
              {resolvedDisputes.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-black/40">No resolved disputes yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
