import type { Metadata } from "next";
import { Settings, CheckCircle2, XCircle, LogOut } from "lucide-react";
import { getSystemHealth, getAuditLogsPage, getStaffUsers, getFeatureFlags, getJobQueue, getLoginOverview } from "@/lib/data";
import { getRenderServiceMatrix } from "@/lib/render";
import { readSession } from "@/lib/session";
import { logoutAction } from "@/lib/actions";
import ServiceHealthMatrix from "@/components/ServiceHealthMatrix";
import AuditLogViewer from "@/components/AuditLogViewer";
import FeatureFlagsPanel from "@/components/FeatureFlagsPanel";
import AlertingSummary from "@/components/AlertingSummary";
import JobQueuePanel from "@/components/JobQueuePanel";
import PrivilegedActivityPanel from "@/components/PrivilegedActivityPanel";
import ImpersonationPanel from "@/components/ImpersonationPanel";
import OperatorOnboardingLauncher from "@/components/OperatorOnboardingLauncher";

export const metadata: Metadata = { title: "System | Ops Console" };

// Same origin as this app in production (nginx's /grafana/ location inside
// the :3002 server block, nginx/nginx.conf) — a relative path means no CSP
// frame-src allowlist entry is needed beyond 'self'. Override for local dev
// without nginx in front (e.g. a Grafana container's own host port).
const GRAFANA_EMBED_URL = process.env.GRAFANA_EMBED_URL || "/grafana/";

function StatusBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span className={`badge font-extrabold text-[10px] inline-flex items-center gap-1 ${ok ? "bg-county-green/10 text-county-green" : "bg-county-red/10 text-county-red"}`}>
      <Icon size={11} strokeWidth={2.5} />
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

export default async function OpsConsolePage() {
  const session = readSession();
  const [health, renderServices, auditPage, staffUsers, featureFlags, jobs, loginOverview] = await Promise.all([
    getSystemHealth(),
    getRenderServiceMatrix(),
    getAuditLogsPage(),
    getStaffUsers(),
    getFeatureFlags(),
    getJobQueue(),
    getLoginOverview(),
  ]);

  return (
    <div className="min-h-screen">
      <header className="bg-county-green-deep text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-white/10 flex items-center justify-center">
              <Settings size={18} strokeWidth={2} />
            </div>
            <div className="leading-tight">
              <div className="font-black text-sm">Ops Console</div>
              <div className="text-[10px] font-bold text-county-yellow tracking-widest uppercase">Nairobi City County · Super Admin</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-white/70">{session?.name}</span>
            <form action={logoutAction}>
              <button type="submit" className="flex items-center gap-1.5 text-xs font-bold text-white/70 hover:text-white transition-colors">
                <LogOut size={14} /> Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-county-ink">System Console</h1>
          <p className="text-sm text-county-ink/55 mt-1">
            Live infrastructure health, security configuration, and the access-control policies actually enforced by this deployment.
          </p>
        </div>

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
                <div className="italic text-black/40">{String(health.database.pool.type)}</div>
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
              This is the backend API process's uptime, not the ops console itself — matches what /system shows in the staff app, since both read the same endpoint.
            </div>
          </div>
        </div>

        <ServiceHealthMatrix services={renderServices} />

        <div className="grid md:grid-cols-2 gap-4">
          <FeatureFlagsPanel flags={featureFlags} />
          <AlertingSummary />
        </div>

        <JobQueuePanel jobs={jobs} />

        <PrivilegedActivityPanel overview={loginOverview} />

        <ImpersonationPanel staff={staffUsers} />

        <OperatorOnboardingLauncher />

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
              Role permissions live in the code&apos;s permission matrix. These are the additional per-record rules layered on top.
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

        {/* Grafana */}
        <div className="card p-5 space-y-4">
          <div>
            <h3 className="font-bold text-sm text-county-black">Metrics (Grafana)</h3>
            <p className="text-xs text-black/50 mt-0.5">
              Dashboards Grafana already builds well — request rates, latency, error rates, resource usage. This console's own cards above cover what Grafana can&apos;t see: RBAC/ABAC and app-specific config state.
            </p>
          </div>
          <iframe
            src={GRAFANA_EMBED_URL}
            title="Grafana dashboards"
            className="w-full h-[600px] rounded-lg border border-black/10"
          />
        </div>

        <AuditLogViewer initialLogs={auditPage.logs} initialCursor={auditPage.nextCursor} users={staffUsers} />
      </main>
    </div>
  );
}
