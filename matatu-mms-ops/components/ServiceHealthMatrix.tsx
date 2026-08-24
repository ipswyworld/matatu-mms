import { CheckCircle2, XCircle, Clock, HelpCircle } from "lucide-react";
import { RenderServiceStatus } from "@/lib/types";

const STATUS_STYLES: Record<string, { icon: typeof CheckCircle2; className: string; label: string }> = {
  live: { icon: CheckCircle2, className: "bg-county-green/10 text-county-green", label: "LIVE" },
  update_in_progress: { icon: Clock, className: "bg-amber-500/10 text-amber-700", label: "DEPLOYING" },
  build_in_progress: { icon: Clock, className: "bg-amber-500/10 text-amber-700", label: "BUILDING" },
  build_failed: { icon: XCircle, className: "bg-county-red/10 text-county-red", label: "BUILD FAILED" },
  update_failed: { icon: XCircle, className: "bg-county-red/10 text-county-red", label: "DEPLOY FAILED" },
  deactivated: { icon: XCircle, className: "bg-black/10 text-black/50", label: "DEACTIVATED" },
  canceled: { icon: XCircle, className: "bg-black/10 text-black/50", label: "CANCELED" },
};

function StatusPill({ status }: { status: string | null }) {
  const style = (status && STATUS_STYLES[status]) || { icon: HelpCircle, className: "bg-black/5 text-black/40", label: status?.toUpperCase() || "UNKNOWN" };
  const Icon = style.icon;
  return (
    <span className={`badge font-extrabold text-[10px] inline-flex items-center gap-1 ${style.className}`}>
      <Icon size={11} strokeWidth={2.5} />
      {style.label}
    </span>
  );
}

export default function ServiceHealthMatrix({ services }: { services: RenderServiceStatus[] | null }) {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Service Health Matrix</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Every service under this Render workspace and its currently-deployed commit — derived live from the Render
          API, not a hand-maintained list.
        </p>
      </div>

      {services === null ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          Not configured — set <span className="font-mono font-bold">RENDER_API_KEY</span> in this service&apos;s
          environment variables to enable the service health matrix. Generate one at{" "}
          <span className="font-mono">dashboard.render.com → Account Settings → API Keys</span>.
        </p>
      ) : services.length === 0 ? (
        <p className="text-xs text-black/40 italic">No services found for this Render account.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-black/40">
                <th className="pb-2 pr-3">Service</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Commit</th>
                <th className="pb-2">Deployed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {services.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-3">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold text-xs text-county-green hover:underline">
                        {s.name}
                      </a>
                    ) : (
                      <span className="font-semibold text-xs text-county-black">{s.name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3"><StatusPill status={s.deployStatus} /></td>
                  <td className="py-2 pr-3">
                    {s.commitId ? (
                      <div>
                        <span className="font-mono text-[11px] text-county-black">{s.commitId.slice(0, 7)}</span>
                        {s.commitMessage && <span className="block text-[10px] text-black/40 truncate max-w-xs">{s.commitMessage}</span>}
                      </div>
                    ) : (
                      <span className="text-black/30 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2 text-[11px] text-black/50 whitespace-nowrap">
                    {s.deployedAt ? new Date(s.deployedAt).toLocaleString() : "—"}
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
