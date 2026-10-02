import { MessageSquare } from "lucide-react";
import { MessagingSpendSummary } from "@/lib/types";

const FAILURE_STATUSES = new Set(["FAILED", "UNDELIVERED"]);

/**
 * Derived entirely from the existing GET /api/messaging/spend response
 * (app/messaging.py's spend_summary, grouped by category+status) — no new
 * backend endpoint needed. MessageLog/MessagingOptOut had zero frontend
 * consumption anywhere before this.
 */
export default function MessagingHealthPanel({ summary }: { summary: MessagingSpendSummary }) {
  const failed = summary.breakdown.filter((b) => FAILURE_STATUSES.has(b.status)).reduce((sum, b) => sum + b.messages, 0);
  const successRate = summary.totalMessages > 0 ? ((summary.totalMessages - failed) / summary.totalMessages) * 100 : null;

  const byCategory = new Map<string, { total: number; failed: number; costKes: number }>();
  for (const b of summary.breakdown) {
    const entry = byCategory.get(b.category) || { total: 0, failed: 0, costKes: 0 };
    entry.total += b.messages;
    if (FAILURE_STATUSES.has(b.status)) entry.failed += b.messages;
    entry.costKes += parseFloat(b.costKes);
    byCategory.set(b.category, entry);
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
          <MessageSquare size={15} strokeWidth={2} className="text-county-ink/50" />
          SMS / Messaging Health
        </h3>
        <p className="text-xs text-black/50 mt-0.5">Last {summary.windowDays} days.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01]">
          <p className="text-[10px] font-bold uppercase tracking-wide text-black/40">Total sent</p>
          <p className="text-lg font-black text-county-black mt-0.5">{summary.totalMessages}</p>
        </div>
        <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01]">
          <p className="text-[10px] font-bold uppercase tracking-wide text-black/40">Delivery success rate</p>
          <p className={`text-lg font-black mt-0.5 ${successRate !== null && successRate < 95 ? "text-county-red" : "text-county-green"}`}>
            {successRate !== null ? `${successRate.toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01]">
          <p className="text-[10px] font-bold uppercase tracking-wide text-black/40">Total cost</p>
          <p className="text-lg font-black text-county-black mt-0.5">KES {summary.totalCostKes}</p>
        </div>
      </div>

      {byCategory.size > 0 && (
        <div className="space-y-1.5">
          {Array.from(byCategory.entries()).map(([category, stats]) => (
            <div key={category} className="flex items-center justify-between text-xs p-2 rounded-lg bg-black/[0.01]">
              <span className="font-semibold text-county-black">{category}</span>
              <span className="text-black/50">
                {stats.total} sent
                {stats.failed > 0 && <span className="text-county-red font-bold"> · {stats.failed} failed</span>}
                <span className="ml-2 font-mono">KES {stats.costKes.toFixed(2)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
