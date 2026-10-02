"use client";

import { useState } from "react";
import { RotateCcw, Rocket, Loader2 } from "lucide-react";
import { RenderServiceStatus, RenderDeploy } from "@/lib/types";
import { triggerDeployAction, rollbackDeployAction, getRenderDeployHistoryAction } from "@/lib/actions";
import ActionButton from "@/components/ActionButton";

/**
 * The write side of the Render integration (Phase 4's highest blast-radius
 * item). ServiceHealthMatrix stays read-only, as it always has been; this
 * is a separate panel specifically so "just look at deploy status" and
 * "change what's deployed" are visually distinct actions, not one table
 * that quietly grew a destructive column.
 */
export default function DeployControlPanel({ services }: { services: RenderServiceStatus[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<RenderDeploy[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedDeployId, setSelectedDeployId] = useState<string>("");

  async function toggleRollback(service: RenderServiceStatus) {
    if (expandedId === service.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(service.id);
    setHistory(null);
    setHistoryError(null);
    setSelectedDeployId("");
    setLoadingHistory(true);
    try {
      const days = await getRenderDeployHistoryAction(service.id);
      setHistory(days);
    } catch (err: any) {
      setHistoryError(err.message || "Could not load deploy history.");
    } finally {
      setLoadingHistory(false);
    }
  }

  if (services.length === 0) return null;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Deploy Control</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Trigger a fresh deploy or roll back to a prior one. Both are Critical actions — reason, typed confirmation,
          and a re-check of your password every time.
        </p>
      </div>

      <div className="space-y-2">
        {services.map((s) => (
          <div key={s.id} className="rounded-lg border border-black/10 p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-semibold text-xs text-county-black">{s.name}</span>
              <div className="flex items-center gap-2">
                <ActionButton
                  actionId="deploy.trigger"
                  target={s.name}
                  onConfirm={(reason, reauthToken) => triggerDeployAction(s.id, reason, reauthToken)}
                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-county-green/30 text-county-green hover:bg-county-green/5 transition-colors inline-flex items-center gap-1.5"
                >
                  <Rocket size={12} /> Deploy latest
                </ActionButton>
                <button
                  type="button"
                  onClick={() => toggleRollback(s)}
                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 transition-colors inline-flex items-center gap-1.5"
                >
                  <RotateCcw size={12} /> Roll back…
                </button>
              </div>
            </div>

            {expandedId === s.id && (
              <div className="mt-3 pt-3 border-t border-black/10 space-y-2">
                {loadingHistory ? (
                  <p className="text-[11px] text-black/40 inline-flex items-center gap-1.5">
                    <Loader2 size={11} className="animate-spin" /> Loading deploy history…
                  </p>
                ) : historyError ? (
                  <p className="text-[11px] text-county-red">{historyError}</p>
                ) : history && history.length > 0 ? (
                  <>
                    <select
                      className="input text-xs"
                      value={selectedDeployId}
                      onChange={(e) => setSelectedDeployId(e.target.value)}
                    >
                      <option value="">Choose a deploy to roll back to…</option>
                      {history.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.finishedAt ? new Date(d.finishedAt).toLocaleString() : "unknown time"} —{" "}
                          {d.commitId ? d.commitId.slice(0, 7) : "no commit"} ({d.status})
                          {d.commitMessage ? ` — ${d.commitMessage.slice(0, 60)}` : ""}
                        </option>
                      ))}
                    </select>
                    {selectedDeployId && (
                      <ActionButton
                        actionId="deploy.rollback"
                        target={s.name}
                        onConfirm={(reason, reauthToken) => rollbackDeployAction(s.id, selectedDeployId, reason, reauthToken)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-county-red/10 text-county-red hover:bg-county-red/20 transition-colors"
                      >
                        Roll back to selected deploy
                      </ActionButton>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-black/40 italic">No deploy history found for this service.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
