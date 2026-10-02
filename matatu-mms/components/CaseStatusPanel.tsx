import { EnforcementCase } from "@/lib/types";

// Every status the backend can set (app/routes/enforcement_cases.py), in
// the order a case actually moves through them. The previous UI only knew
// five of these, which is why UNDER_REVIEW and the three RESOLVED_* states
// appeared in neither the open nor the closed table — those cases simply
// vanished from the screen. Listing every status here is what stops a case
// going missing again.
const STATUS_ORDER: { key: string; label: string; tone: "red" | "amber" | "green" | "grey"; note: string }[] = [
  { key: "ARRESTED", label: "Held — fine unpaid", tone: "red", note: "Vehicle held, fine outstanding" },
  { key: "PAID", label: "Paid — awaiting release", tone: "amber", note: "Fine settled, vehicle still held" },
  { key: "DISPUTED", label: "Disputed", tone: "amber", note: "Contested, awaiting a reviewer" },
  { key: "UNDER_REVIEW", label: "Under review", tone: "amber", note: "Reviewer assigned" },
  { key: "RESOLVED_UPHELD", label: "Dispute upheld", tone: "amber", note: "Fine stands and is still payable" },
  { key: "RESOLVED_PARTIAL", label: "Partially relieved", tone: "amber", note: "Reviewed, partial relief granted" },
  { key: "RESOLVED_OVERTURNED", label: "Overturned", tone: "green", note: "Fine cancelled on review" },
  { key: "RELEASED", label: "Released", tone: "green", note: "Paid and vehicle released" },
  { key: "WAIVED", label: "Waived", tone: "grey", note: "Fine written off with authorisation" },
];

const TONE_CLASS: Record<string, string> = {
  red: "bg-county-red/10 text-county-red",
  amber: "bg-county-yellow/20 text-county-yellow-dark",
  green: "bg-county-green/10 text-county-green",
  grey: "bg-black/[0.06] text-black/50",
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * "Status of" — where every case actually stands, with the money and the
 * clock attached.
 *
 * A count on its own does not tell a commander whether anything is going
 * wrong. A vehicle paid for three weeks ago and still not released is a
 * different problem from one impounded this morning, and the difference is
 * only visible if the oldest case's age sits next to the count.
 */
export default function CaseStatusPanel({ cases }: { cases: EnforcementCase[] }) {
  const rows = STATUS_ORDER.map((status) => {
    const matching = cases.filter((c) => c.status === status.key);
    const value = matching.reduce((sum, c) => sum + (c.fineAmountKes || 0), 0);
    const oldest = matching.reduce<string | null>(
      (acc, c) => (!acc || c.createdAt < acc ? c.createdAt : acc),
      null
    );
    return { ...status, count: matching.length, value, oldest };
  });

  const known = new Set(STATUS_ORDER.map((s) => s.key));
  // Anything the backend adds later shows up here rather than disappearing.
  const unknown = cases.filter((c) => !known.has(c.status));

  const stillHeld = rows
    .filter((r) => r.key === "ARRESTED" || r.key === "PAID")
    .reduce((sum, r) => sum + r.count, 0);
  const outstanding = rows
    .filter((r) => ["ARRESTED", "RESOLVED_UPHELD", "RESOLVED_PARTIAL"].includes(r.key))
    .reduce((sum, r) => sum + r.value, 0);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h3 className="font-bold text-sm text-county-black">Case status</h3>
          <p className="text-[11px] text-black/50 mt-0.5">
            Where every enforcement case stands right now — held, paid, disputed, released.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wide">
          <span className="text-black/45">
            Still held <span className="text-county-red">{stillHeld}</span>
          </span>
          <span className="text-black/45">
            Outstanding <span className="text-county-red">KES {outstanding.toLocaleString()}</span>
          </span>
        </div>
      </div>

      {cases.length === 0 ? (
        <p className="text-xs text-black/40 italic">No enforcement cases filed yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wide text-black/40 border-b border-black/[0.07]">
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3 text-right">Cases</th>
                <th className="pb-2 pr-3 text-right">Fine value (KES)</th>
                <th className="pb-2">Oldest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.05]">
              {rows
                .filter((r) => r.count > 0)
                .map((r) => (
                  <tr key={r.key}>
                    <td className="py-2 pr-3">
                      <span className={`badge text-[9px] font-extrabold ${TONE_CLASS[r.tone]}`}>{r.label}</span>
                      <span className="block text-[10px] text-black/40 mt-1">{r.note}</span>
                    </td>
                    <td className="py-2 pr-3 text-right font-black text-county-black tabular-nums">{r.count}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-black/70 tabular-nums">
                      {r.value.toLocaleString()}
                    </td>
                    <td className="py-2 text-[11px] text-black/55">
                      {r.oldest ? (
                        <>
                          {new Date(r.oldest).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                          <span className="block text-[10px] text-black/35">
                            {daysSince(r.oldest)} day{daysSince(r.oldest) === 1 ? "" : "s"} ago
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              {unknown.length > 0 && (
                <tr>
                  <td className="py-2 pr-3">
                    <span className="badge text-[9px] font-extrabold bg-black/[0.06] text-black/50">
                      Other
                    </span>
                    <span className="block text-[10px] text-black/40 mt-1">
                      {[...new Set(unknown.map((c) => c.status))].join(", ")}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-black text-county-black tabular-nums">
                    {unknown.length}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-black/70 tabular-nums">
                    {unknown.reduce((s, c) => s + (c.fineAmountKes || 0), 0).toLocaleString()}
                  </td>
                  <td className="py-2 text-[11px] text-black/40">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
