import type { Metadata } from "next";
import Link from "next/link";
import { getSystemHealth } from "@/lib/data";
import PageBanner from "@/components/PageBanner";

export const metadata: Metadata = { title: "System" };

function StatusBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return (
    <span
      className={`badge font-extrabold text-[10px] ${
        ok ? "bg-county-green/10 text-county-green" : "bg-county-red/10 text-county-red"
      }`}
    >
      {ok ? okLabel : badLabel}
    </span>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default async function SystemPage() {
  const health = await getSystemHealth();

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Super Admin"
        title="System Console"
        subtitle="Live infrastructure health, security configuration, and the access-control policies actually enforced by this deployment."
      />

      {/* Health row */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-county-black">Database</h3>
            <StatusBadge ok={health.database.reachable} okLabel="REACHABLE" badLabel="UNREACHABLE" />
          </div>
          <div className="text-xs text-black/60 space-y-1">
            <div>Engine: <span className="font-semibold text-county-black">{health.database.engine}</span></div>
            {health.database.pool.type === "QueuePool" ? (
              <>
                <div>Pool size: <span className="font-semibold text-county-black">{health.database.pool.size}</span></div>
                <div>Checked out: <span className="font-semibold text-county-black">{health.database.pool.checkedOut}</span> / in: <span className="font-semibold text-county-black">{health.database.pool.checkedIn}</span></div>
              </>
            ) : (
              <div className="italic text-black/40">{health.database.pool.type}</div>
            )}
            {health.database.error && (
              <div className="text-county-red font-semibold pt-1">{health.database.error}</div>
            )}
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-county-black">Redis</h3>
            <StatusBadge ok={health.redis.reachable} okLabel="REACHABLE" badLabel="UNREACHABLE" />
          </div>
          <div className="text-xs text-black/60">
            Powers real-time telemetry, dashboard refresh, and per-user notifications.
          </div>
          {health.redis.error && (
            <div className="text-xs text-county-red font-semibold">{health.redis.error}</div>
          )}
        </div>

        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-county-black">Process</h3>
            <span className="badge bg-county-blue/10 text-county-blue font-extrabold text-[10px]">
              {formatUptime(health.uptimeSeconds)} UPTIME
            </span>
          </div>
          <div className="text-xs text-black/60">
            Uptime resets on every backend restart or deploy.
          </div>
        </div>
      </div>

      {/* Config row */}
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-bold text-sm text-county-black">Security Configuration</h3>
          <p className="text-xs text-black/50 mt-0.5">Whether each secret was explicitly set, never the secret's actual value.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] flex items-center justify-between">
            <span className="text-xs font-semibold text-county-black">SECRET_KEY</span>
            <StatusBadge ok={health.config.secretKeyConfigured} okLabel="SET" badLabel="AUTO-GENERATED" />
          </div>
          <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] flex items-center justify-between">
            <span className="text-xs font-semibold text-county-black">NAIROBIPAY_CALLBACK_SECRET</span>
            <StatusBadge ok={health.config.nairobiPayCallbackSecretConfigured} okLabel="SET" badLabel="AUTO-GENERATED" />
          </div>
          <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] flex items-center justify-between">
            <span className="text-xs font-semibold text-county-black">SENTRY_DSN</span>
            <StatusBadge ok={health.config.sentryConfigured} okLabel="SET" badLabel="NOT SET" />
          </div>
        </div>
        {(!health.config.secretKeyConfigured || !health.config.nairobiPayCallbackSecretConfigured) && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Auto-generated secrets are regenerated on every restart, invalidating existing sessions/tokens. Set these explicitly before deploying.
          </p>
        )}
      </div>

      {/* ABAC policy inspector */}
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-bold text-sm text-county-black">Access Control Policies (RBAC + ABAC)</h3>
          <p className="text-xs text-black/50 mt-0.5">
            Role permissions live in the code&apos;s permission matrix. These are the additional per-record rules layered on top — who can see or touch a specific record, not just who can use a feature.
          </p>
        </div>
        <div className="space-y-2.5">
          {health.abacPolicies.map((p) => (
            <div key={p.id} className="p-3 rounded-lg border border-black/10 bg-black/[0.01]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-county-green">{p.id}</span>
                <div className="flex gap-1.5 flex-wrap">
                  {p.appliesToRoles.map((r) => (
                    <span key={r} className="badge bg-black/5 text-black/60 text-[9px] font-bold">{r}</span>
                  ))}
                </div>
              </div>
              <p className="text-xs text-black/70 mt-1.5">{p.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Links out */}
      <div className="card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-sm text-county-black">Audit Trail</h3>
          <p className="text-xs text-black/50 mt-0.5">Every create/update recorded across the system, with before/after values.</p>
        </div>
        <Link href="/audit-logs" className="rounded-lg px-4 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors">
          Open Audit Trail →
        </Link>
      </div>
    </div>
  );
}
