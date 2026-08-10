import { readSession } from "@/lib/session";
import { getEnforcementCases } from "@/lib/data";
import { can } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";
import EnforcementCaseActions from "@/components/EnforcementCaseActions";

const PUBLIC_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";

const STATUS_STYLES: Record<string, string> = {
  ARRESTED: "bg-amber-100 text-amber-700",
  PAID: "bg-county-blue/10 text-county-blue",
  RELEASED: "bg-county-green/10 text-county-green",
  DISPUTED: "bg-county-red/10 text-county-red",
  WAIVED: "bg-black/10 text-black/60",
};

export default async function EnforcementCasesPage() {
  const session = readSession()!;
  const cases = await getEnforcementCases();
  const canDecide = can(session.role, "decide_enforcement_case");

  const openCases = cases.filter((c) => c.status === "ARRESTED" || c.status === "PAID");
  const closedCases = cases.filter((c) => c.status === "RELEASED" || c.status === "DISPUTED" || c.status === "WAIVED");

  return (
    <div className="space-y-6">
      <PageBanner
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
                    {c.photoPaths.length > 0 ? (
                      <div className="flex gap-1 flex-wrap">
                        {c.photoPaths.map((p) => (
                          <a key={p} href={`${PUBLIC_BACKEND_URL}${p}`} target="_blank" className="text-county-blue hover:underline text-[10px]">
                            Photo
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-black/30 text-[10px] italic">None</span>
                    )}
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
