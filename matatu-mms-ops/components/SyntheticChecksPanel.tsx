import { CheckCircle2, XCircle } from "lucide-react";
import { SyntheticCheckTarget } from "@/lib/types";

function LatencyBars({ recent }: { recent: SyntheticCheckTarget["recent"] }) {
  if (recent.length === 0) return null;
  const max = Math.max(1, ...recent.map((p) => p.latencyMs ?? 0));
  return (
    <div className="flex items-end gap-[2px] h-8 mt-2">
      {recent.map((p, i) => (
        <div
          key={i}
          title={`${new Date(p.checkedAt).toLocaleTimeString()}: ${p.ok ? `${p.latencyMs}ms` : "down"}`}
          className={`flex-1 rounded-sm min-h-[2px] ${p.ok ? "bg-county-green/70" : "bg-county-red"}`}
          style={{ height: p.ok ? `${Math.max(8, ((p.latencyMs ?? 0) / max) * 100)}%` : "100%" }}
        />
      ))}
    </div>
  );
}

/**
 * Reads what app/synthetic_checks.py's ARQ cron recorded (every 5 minutes,
 * hitting each frontend's own /api/health). Proves a check ran from inside
 * this cluster — not the same guarantee as a real external uptime service,
 * which would also catch a cluster-wide network partition.
 */
export default function SyntheticChecksPanel({ targets }: { targets: SyntheticCheckTarget[] }) {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Synthetic Uptime Checks</h3>
        <p className="text-xs text-black/50 mt-0.5">
          This backend probing each app&apos;s own /api/health every 5 minutes. Not a substitute for a real external
          uptime monitor — it can&apos;t see a network partition that takes this whole cluster offline.
        </p>
      </div>

      {targets.length === 0 ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          No targets configured — set <span className="font-mono font-bold">STAFF_APP_URL</span>,{" "}
          <span className="font-mono font-bold">PUBLIC_APP_URL</span>, and/or{" "}
          <span className="font-mono font-bold">OPS_APP_URL</span> on the backend service to enable checks.
        </p>
      ) : (
        <div className="grid sm:grid-cols-3 gap-3">
          {targets.map((t) => (
            <div key={t.targetName} className="p-3 rounded-lg border border-black/10 bg-black/[0.01]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-county-black">{t.targetName}</span>
                <span
                  className={`badge text-[9px] font-extrabold inline-flex items-center gap-1 ${
                    t.latest.ok ? "bg-county-green/10 text-county-green" : "bg-county-red/10 text-county-red"
                  }`}
                >
                  {t.latest.ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {t.latest.ok ? "UP" : "DOWN"}
                </span>
              </div>
              <p className="text-[10px] text-black/40 mt-1">
                {t.latest.ok ? `${t.latest.latencyMs}ms` : t.latest.error || "no response"} ·{" "}
                {new Date(t.latest.checkedAt).toLocaleTimeString()}
              </p>
              <LatencyBars recent={t.recent} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
