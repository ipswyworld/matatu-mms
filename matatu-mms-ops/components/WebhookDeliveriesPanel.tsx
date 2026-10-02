"use client";

import type { WebhookDelivery } from "@/lib/types";
import { replayWebhookAction } from "@/lib/actions";
import ActionButton from "./ActionButton";

export default function WebhookDeliveriesPanel({ deliveries }: { deliveries: WebhookDelivery[] }) {
  const failed = deliveries.filter((d) => !d.succeeded).length;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-county-black">Webhook Deliveries</h3>
          <p className="text-xs text-black/50 mt-0.5">
            Replay re-sends through the normal queued path, so it inherits the same retry and circuit-breaker
            behaviour as an original delivery rather than bypassing them.
          </p>
        </div>
        <span
          className={`badge text-[10px] font-bold shrink-0 ${
            failed > 0 ? "bg-county-red/10 text-county-red" : "bg-county-green/10 text-county-green"
          }`}
        >
          {failed} FAILED
        </span>
      </div>

      {deliveries.length === 0 ? (
        <p className="text-xs text-black/40 italic">No webhook deliveries recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-black/40">
                <th className="pb-2 pr-3">Event</th>
                <th className="pb-2 pr-3">Sub</th>
                <th className="pb-2 pr-3">Result</th>
                <th className="pb-2 pr-3">Try</th>
                <th className="pb-2 pr-3">When</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 pr-3 font-mono text-[11px] text-county-black">{d.eventType}</td>
                  <td className="py-2 pr-3 text-[11px] text-black/50">#{d.subscriptionId}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`badge text-[9px] font-extrabold ${
                        d.succeeded ? "bg-county-green/10 text-county-green" : "bg-county-red/10 text-county-red"
                      }`}
                    >
                      {d.statusCode ?? "ERROR"}
                    </span>
                    {d.errorMessage && (
                      <div className="text-[10px] text-county-red mt-0.5 max-w-xs truncate" title={d.errorMessage}>
                        {d.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-black/50">{d.attempt}</td>
                  <td className="py-2 pr-3 text-[11px] text-black/50 whitespace-nowrap">
                    {d.timestamp ? new Date(d.timestamp).toLocaleString() : "—"}
                  </td>
                  <td className="py-2 text-right">
                    <ActionButton
                      actionId="webhook.replay"
                      target={`${d.eventType} to subscription #${d.subscriptionId}`}
                      onConfirm={(reason) => replayWebhookAction(d.id, reason)}
                    >
                      Replay
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
