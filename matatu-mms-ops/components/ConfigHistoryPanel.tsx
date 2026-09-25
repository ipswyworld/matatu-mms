"use client";

import { useState } from "react";
import { History, Loader2 } from "lucide-react";
import { ConfigHistoryEntry } from "@/lib/types";
import { revertConfigEntryAction, getConfigHistoryAction } from "@/lib/actions";
import ActionButton from "@/components/ActionButton";
import ConfigDiff from "@/components/ConfigDiff";

const RESOURCE_LABEL: Record<string, string> = {
  rate_limit: "Rate limit",
  circuit_breaker: "Circuit breaker",
  feature_flag: "Feature flag",
};

function formatValues(values: Record<string, any> | null): string {
  if (!values) return "—";
  const { reason, ...rest } = values;
  return Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") || "—";
}

/**
 * Timeline over the config-CRUD slice of the audit log (rate limits,
 * circuit breakers, feature flags), with one-click revert. Deliberately
 * excludes maintenance mode and kill switches — see revertConfigEntryAction
 * and the config.revert descriptor for why those stay Critical-gated
 * forward-only actions instead of history-revertible ones.
 */
export default function ConfigHistoryPanel({ initial }: { initial: { entries: ConfigHistoryEntry[]; nextCursor: number | null } }) {
  const [entries, setEntries] = useState(initial.entries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await getConfigHistoryAction(cursor);
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
          <History size={15} strokeWidth={2} className="text-county-ink/50" />
          Config History
        </h3>
        <p className="text-xs text-black/50 mt-0.5">
          Every rate-limit, circuit-breaker, and feature-flag change — revert to a prior value with one click.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-black/40 italic">No config changes recorded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 text-[11px] py-2 border-b border-black/5 last:border-0 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="badge bg-black/5 text-black/60 text-[9px] font-bold">{RESOURCE_LABEL[e.resourceType] || e.resourceType}</span>
                  <span className="font-mono text-county-black font-semibold">{e.resourceId}</span>
                  <span className="text-black/40">{e.action}</span>
                </div>
                <p className="text-black/50 mt-0.5">
                  {formatValues(e.oldValues)} → {formatValues(e.newValues)}
                </p>
                <p className="text-black/35 mt-0.5">{new Date(e.timestamp).toLocaleString()} · {e.userId}</p>
              </div>
              {e.oldValues && (
                <ActionButton
                  actionId="config.revert"
                  target={`${RESOURCE_LABEL[e.resourceType] || e.resourceType} ${e.resourceId}`}
                  onConfirm={(reason) => revertConfigEntryAction(e, reason)}
                  preview={<ConfigDiff label={e.resourceId} from={formatValues(e.newValues)} to={formatValues(e.oldValues)} />}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5 transition-colors shrink-0"
                >
                  Revert
                </ActionButton>
              )}
            </div>
          ))}
        </div>
      )}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="text-[11px] font-bold text-county-green hover:underline inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {loadingMore && <Loader2 size={11} className="animate-spin" />}
          Load more
        </button>
      )}
    </div>
  );
}
