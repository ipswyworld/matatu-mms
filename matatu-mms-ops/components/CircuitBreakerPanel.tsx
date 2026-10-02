"use client";

import type { CircuitBreakerState } from "@/lib/types";
import { overrideBreakerAction } from "@/lib/actions";
import ActionButton from "./ActionButton";

const STATE_STYLES: Record<string, string> = {
  CLOSED: "bg-county-green/10 text-county-green",
  OPEN: "bg-county-red/10 text-county-red",
  "HALF-OPEN": "bg-amber-100 text-amber-800",
};

const OVERRIDES = [
  { value: "auto", label: "Auto", help: "Normal failure-driven behaviour." },
  { value: "closed", label: "Force closed", help: "Let all calls through immediately." },
  { value: "open", label: "Force open", help: "Reject all calls to this dependency." },
];

export default function CircuitBreakerPanel({ breakers }: { breakers: CircuitBreakerState[] }) {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Circuit Breakers</h3>
        <p className="text-xs text-black/50 mt-0.5">
          When a third party is known to be down, forcing a breaker open stops the system rediscovering that one
          failed call at a time. Overrides apply to the replica that receives them, because a breaker guards that
          process&apos;s own calls.
        </p>
      </div>

      {breakers.length === 0 ? (
        <p className="text-xs text-black/40 italic">
          No breakers registered yet. They appear here once a guarded dependency has been called at least once in
          this process.
        </p>
      ) : (
        <div className="space-y-2.5">
          {breakers.map((b) => (
            <div
              key={b.name}
              className={`rounded-lg border p-3.5 ${
                b.effectivelyBlocking ? "border-county-red/30 bg-county-red/5" : "border-black/10 bg-black/[0.01]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] font-bold text-county-green">{b.name}</span>
                    <span className={`badge text-[9px] font-extrabold ${STATE_STYLES[b.state] || "bg-black/5 text-black/60"}`}>
                      {b.state}
                    </span>
                    {b.override !== "auto" && (
                      <span className="badge text-[9px] font-extrabold bg-amber-100 text-amber-800">
                        HELD {b.override.toUpperCase()}
                      </span>
                    )}
                  </div>
                  {b.description && <p className="text-[11px] text-black/60 mt-1">{b.description}</p>}
                  <p className="text-[10px] text-black/40 mt-0.5">
                    {b.failureCount}/{b.failureThreshold} failures · recovers after {b.recoveryTime}s
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {OVERRIDES.filter((o) => o.value !== b.override).map((o) => (
                    <ActionButton
                      key={o.value}
                      actionId="breaker.override"
                      target={`${b.name} → ${o.label.toLowerCase()}`}
                      onConfirm={(reason) => overrideBreakerAction(b.name, o.value, reason)}
                      preview={<span className="text-black/60">{o.help}</span>}
                    >
                      {o.label}
                    </ActionButton>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
