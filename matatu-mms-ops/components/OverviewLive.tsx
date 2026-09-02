"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, PowerOff, Radio, WifiOff, XCircle } from "lucide-react";
import { useOpsStream } from "@/lib/useOpsStream";
import type { DependencyState, OpsSnapshot, SeriesPoint } from "@/lib/types";

/**
 * The incident overview (Ops Console Rebuild Spec §5.1).
 *
 * One component owns the SSE subscription and renders everything derived
 * from it, so the page holds a single connection rather than one per panel.
 */
export default function OverviewLive({ initial }: { initial: OpsSnapshot | null }) {
  const { snapshot, status, lastEventAt } = useOpsStream(initial);

  if (!snapshot) {
    return (
      <div className="card p-8 text-center text-sm text-black/50">
        Waiting for the first snapshot from the control plane…
      </div>
    );
  }

  const stale = status !== "live";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight text-county-ink">Incident Overview</h1>
          <p className="text-xs text-black/50 mt-0.5">
            Live state of every hard dependency, updating every few seconds.
          </p>
        </div>
        <StreamBadge status={status} lastEventAt={lastEventAt} />
      </div>

      {/* An active maintenance window or engaged kill switch must be the
          first thing an operator sees — otherwise the obvious question
          during an incident ("is this us?") goes unanswered. */}
      {snapshot.controls?.maintenance.enabled && (
        <div className="rounded-lg border border-county-red/30 bg-county-red/5 px-4 py-3 flex items-start gap-2">
          <PowerOff size={15} className="text-county-red shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-xs font-bold text-county-red">
              Maintenance mode is ACTIVE (scope: {snapshot.controls.maintenance.scope})
            </div>
            <p className="text-[11px] text-black/60 mt-0.5">
              {snapshot.controls.maintenance.scope === "all"
                ? "All traffic is being rejected, staff included."
                : "Public traffic is being rejected. Staff endpoints remain reachable."}{" "}
              Turn it off from Config.
            </p>
          </div>
        </div>
      )}

      {(snapshot.controls?.killSwitches ?? []).some((k) => k.killed) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          Kill switches engaged:{" "}
          {snapshot.controls.killSwitches
            .filter((k) => k.killed)
            .map((k) => k.feature)
            .join(", ")}
        </div>
      )}

      {/* A stale feed must be obvious. The single worst failure for this
          page is showing old numbers that look current. */}
      {stale && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          {status === "failed"
            ? "Live updates stopped. The figures below are from the last successful snapshot and are no longer current — reload to retry."
            : "Reconnecting to the control plane. Figures below may be a few seconds stale."}
        </div>
      )}

      <DependencyStrip dependencies={snapshot.dependencies} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Requests / sec" value={snapshot.metrics.requestsPerSecond.toFixed(2)} sub={`${snapshot.metrics.totalRequests} in ${snapshot.metrics.windowSeconds}s`} />
        <Metric
          label="Error rate"
          value={`${(snapshot.metrics.errorRate * 100).toFixed(1)}%`}
          sub={`${snapshot.metrics.serverErrorCount} server errors`}
          alarming={snapshot.metrics.errorRate > 0.05}
        />
        <Metric
          label="p95 latency"
          value={snapshot.metrics.p95Ms === null ? "—" : `${snapshot.metrics.p95Ms} ms`}
          sub={
            snapshot.metrics.latencyIsWorstInstance
              ? `worst of ${snapshot.metrics.instanceCount} replicas`
              : snapshot.metrics.p50Ms === null
                ? "no samples"
                : `p50 ${snapshot.metrics.p50Ms} ms`
          }
        />
        <Metric
          label="Queue"
          value={String(snapshot.queue.queued + snapshot.queue.inProgress)}
          sub={`${snapshot.queue.failed} failed · ${snapshot.queue.inProgress} running`}
          alarming={snapshot.queue.failed > 0}
        />
      </div>

      <div className="card p-5">
        <h3 className="font-bold text-sm text-county-black mb-3">Request volume</h3>
        <Sparkline series={snapshot.series} />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm text-county-black">Recent server errors</h3>
          <span className="text-[10px] font-bold text-black/40">5xx ONLY</span>
        </div>
        {snapshot.recentErrors.length === 0 ? (
          <p className="text-xs text-black/40 italic">No server errors recorded in this window.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {snapshot.recentErrors.map((e, i) => (
              <div key={`${e.at}-${i}`} className="flex items-center justify-between gap-3 text-[11px] py-1.5 border-b border-black/5 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="badge bg-county-red/10 text-county-red text-[9px] font-extrabold shrink-0">{e.status}</span>
                  <span className="font-mono text-black/70 truncate">
                    {e.method} {e.path}
                  </span>
                </div>
                <span className="text-black/40 shrink-0">
                  {new Date(e.at * 1000).toLocaleTimeString()} · {e.durationMs}ms
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StreamBadge({ status, lastEventAt }: { status: string; lastEventAt: number | null }) {
  const map: Record<string, { label: string; cls: string; Icon: typeof Radio }> = {
    live: { label: "LIVE", cls: "bg-county-green/10 text-county-green", Icon: Radio },
    connecting: { label: "CONNECTING", cls: "bg-black/5 text-black/50", Icon: CircleDashed },
    reconnecting: { label: "RECONNECTING", cls: "bg-amber-100 text-amber-800", Icon: CircleDashed },
    failed: { label: "DISCONNECTED", cls: "bg-county-red/10 text-county-red", Icon: WifiOff },
  };
  const { label, cls, Icon } = map[status] ?? map.connecting;
  return (
    <div className="flex items-center gap-2">
      <span className={`badge text-[9px] font-extrabold inline-flex items-center gap-1 ${cls}`}>
        <Icon size={10} className={status === "live" ? "animate-pulse" : ""} />
        {label}
      </span>
      {lastEventAt && (
        <span className="text-[10px] text-black/40">updated {new Date(lastEventAt).toLocaleTimeString()}</span>
      )}
    </div>
  );
}

function DependencyStrip({ dependencies }: { dependencies: DependencyState[] }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {dependencies.map((d) => {
        const Icon = d.status === "ok" ? CheckCircle2 : d.status === "degraded" ? AlertTriangle : XCircle;
        const cls =
          d.status === "ok"
            ? "border-county-green/25 bg-county-green/5"
            : d.status === "degraded"
              ? "border-amber-300 bg-amber-50"
              : "border-county-red/30 bg-county-red/5";
        const iconCls =
          d.status === "ok" ? "text-county-green" : d.status === "degraded" ? "text-amber-600" : "text-county-red";
        return (
          <div key={d.name} className={`rounded-xl border p-3.5 ${cls}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-county-ink truncate">{d.name}</span>
              <Icon size={14} className={`${iconCls} shrink-0`} />
            </div>
            <div className="text-[10px] text-black/50 mt-1">
              {d.latencyMs !== null ? `${d.latencyMs} ms` : d.status === "ok" ? "healthy" : "—"}
            </div>
            {d.error && <div className="text-[10px] text-county-red font-semibold mt-1 break-words">{d.error}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  alarming = false,
}: {
  label: string;
  value: string;
  sub: string;
  alarming?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-black/40">{label}</div>
      <div className={`text-2xl font-black mt-1 ${alarming ? "text-county-red" : "text-county-ink"}`}>{value}</div>
      <div className="text-[10px] text-black/45 mt-0.5">{sub}</div>
    </div>
  );
}

/** Inline SVG rather than a charting library: one bounded series, redrawn
 *  every few seconds, does not justify the bundle cost on a page that has
 *  to load fast during an incident. */
function Sparkline({ series }: { series: SeriesPoint[] }) {
  if (series.length === 0) return <p className="text-xs text-black/40 italic">No data yet.</p>;

  const width = 800;
  const height = 80;
  const max = Math.max(1, ...series.map((p) => p.requests));
  const step = width / Math.max(1, series.length - 1);

  const line = series.map((p, i) => `${i * step},${height - (p.requests / max) * height}`).join(" ");
  const errorLine = series.map((p, i) => `${i * step},${height - (p.errors / max) * height}`).join(" ");

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-20" preserveAspectRatio="none" role="img" aria-label="Requests per second over the last minute">
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" className="text-county-green" vectorEffect="non-scaling-stroke" />
        <polyline points={errorLine} fill="none" stroke="currentColor" strokeWidth="2" className="text-county-red" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex items-center gap-4 mt-2 text-[10px] text-black/45">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3 bg-county-green inline-block" /> requests
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3 bg-county-red inline-block" /> errors
        </span>
        <span>peak {max}/s</span>
      </div>
    </div>
  );
}
