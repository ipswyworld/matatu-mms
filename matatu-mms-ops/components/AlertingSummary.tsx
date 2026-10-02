// Read-only, sourced from the real alertmanager/alertmanager.yml config —
// not live-editable from here. That file is applied via docker-compose
// (envsubst at container start) in the self-hosted deployment path; the
// Render-hosted topology this console runs in doesn't run an Alertmanager
// container alongside it, so there is no live instance to CRUD against
// safely. This card exists for the same reason the ABAC Policies card
// does: "what rule is actually in force" should be answerable without
// reading a YAML file, even when the answer isn't live-editable here.
const ROUTES = [
  {
    severity: "critical",
    example: "BackendDown",
    channel: "#matatu-mms-incidents",
    groupWait: "10s",
    repeatInterval: "30m",
    tone: "bg-county-red/10 text-county-red",
  },
  {
    severity: "warning",
    example: "HighErrorRate, HighRequestLatency",
    channel: "#matatu-mms-alerts",
    groupWait: "30s",
    repeatInterval: "4h",
    tone: "bg-amber-500/10 text-amber-700",
  },
];

export default function AlertingSummary() {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Alerting</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Current severity routing, from <span className="font-mono">alertmanager/alertmanager.yml</span>. Edit that
          file and redeploy to change it — no live Alertmanager instance runs alongside this Render-hosted console
          to CRUD against.
        </p>
      </div>
      <div className="space-y-2.5">
        {ROUTES.map((r) => (
          <div key={r.severity} className="p-3 rounded-lg border border-black/10 bg-black/[0.01]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`badge text-[10px] font-bold ${r.tone}`}>{r.severity.toUpperCase()}</span>
              <span className="font-mono text-[11px] font-bold text-county-black">{r.channel}</span>
            </div>
            <p className="text-xs text-black/70 mt-1.5">
              e.g. <span className="italic">{r.example}</span> — pages after {r.groupWait}, repeats every {r.repeatInterval} until resolved.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
