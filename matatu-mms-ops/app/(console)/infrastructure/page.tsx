import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { getSystemHealth } from "@/lib/data";
import { getRenderServiceMatrix } from "@/lib/render";
import ServiceHealthMatrix from "@/components/ServiceHealthMatrix";
import AlertingSummary from "@/components/AlertingSummary";
import OperatorOnboardingLauncher from "@/components/OperatorOnboardingLauncher";
import PanelError, { settle } from "@/components/PanelError";

export const metadata: Metadata = { title: "Infrastructure | Ops Console" };
export const dynamic = "force-dynamic";

// Unset by default. Rendering an iframe against a URL that isn't configured
// produces a permanent empty box, which trains operators to ignore part of
// the page — so this is surfaced honestly instead (Spec §21.6).
const GRAFANA_EMBED_URL = process.env.GRAFANA_EMBED_URL;

function StatusBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span
      className={`badge font-extrabold text-[10px] inline-flex items-center gap-1 ${
        ok ? "bg-county-green/10 text-county-green" : "bg-county-red/10 text-county-red"
      }`}
    >
      <Icon size={11} strokeWidth={2.5} />
      {ok ? okLabel : badLabel}
    </span>
  );
}

export default async function InfrastructurePage() {
  const [health, renderServices] = await Promise.all([
    settle(getSystemHealth()),
    settle(getRenderServiceMatrix()),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Infrastructure</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Deployed versions, alert routing, security configuration, and the access-control policies this deployment
          actually enforces.
        </p>
      </div>

      {renderServices.data ? (
        <ServiceHealthMatrix services={renderServices.data} />
      ) : (
        <PanelError title="Service health matrix" error={renderServices.error!} />
      )}

      <AlertingSummary />

      {health.data ? (
        <>
          <div className="card p-5 space-y-4">
            <div>
              <h3 className="font-bold text-sm text-county-black">Security Configuration</h3>
              <p className="text-xs text-black/50 mt-0.5">Whether each secret was explicitly set, never its value.</p>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-county-black">SECRET_KEY</span>
                <StatusBadge ok={health.data.config.secretKeyConfigured} okLabel="SET" badLabel="AUTO-GENERATED" />
              </div>
              <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-county-black">NAIROBIPAY_CALLBACK_SECRET</span>
                <StatusBadge
                  ok={health.data.config.nairobiPayCallbackSecretConfigured}
                  okLabel="SET"
                  badLabel="AUTO-GENERATED"
                />
              </div>
              <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-county-black">SENTRY_DSN</span>
                <StatusBadge ok={health.data.config.sentryConfigured} okLabel="SET" badLabel="NOT SET" />
              </div>
            </div>
            {(!health.data.config.secretKeyConfigured || !health.data.config.nairobiPayCallbackSecretConfigured) && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Auto-generated secrets are regenerated on every restart, invalidating existing sessions and tokens.
                Set these explicitly before deploying.
              </p>
            )}
          </div>

          <div className="card p-5 space-y-4">
            <div>
              <h3 className="font-bold text-sm text-county-black">Access Control Policies (RBAC + ABAC)</h3>
              <p className="text-xs text-black/50 mt-0.5">
                Role permissions live in the code&apos;s permission matrix. These are the additional per-record rules
                layered on top.
              </p>
            </div>
            <div className="space-y-2.5">
              {health.data.abacPolicies.map((p) => (
                <div key={p.id} className="p-3 rounded-lg border border-black/10 bg-black/[0.01]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-county-green">{p.id}</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {p.appliesToRoles.map((r) => (
                        <span key={r} className="badge bg-black/5 text-black/60 text-[9px] font-bold">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-black/70 mt-1.5">{p.description}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <PanelError title="System health" error={health.error!} />
      )}

      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-bold text-sm text-county-black">Metrics (Grafana)</h3>
          <p className="text-xs text-black/50 mt-0.5">
            Grafana owns request rates, latency, error rates, and resource usage over time. The Overview tab covers
            what it cannot see: live dependency state and the app-specific config this console controls.
          </p>
        </div>
        {GRAFANA_EMBED_URL ? (
          <iframe
            src={GRAFANA_EMBED_URL}
            title="Grafana dashboards"
            className="w-full h-[600px] rounded-lg border border-black/10"
          />
        ) : (
          <p className="text-[11px] text-black/50 bg-black/[0.02] border border-black/10 rounded-lg px-3 py-2.5">
            Not configured — set <span className="font-mono font-semibold">GRAFANA_EMBED_URL</span> for this service
            to embed dashboards here. No Grafana instance is deployed alongside this console yet.
          </p>
        )}
      </div>

      <OperatorOnboardingLauncher />
    </div>
  );
}
