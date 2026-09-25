import { ArrowRight } from "lucide-react";

/**
 * Hand-maintained service dependency map — deliberately static config, not
 * auto-discovered. No call-graph/tracing instrumentation exists anywhere in
 * this codebase to derive this from automatically (OTEL_EXPORTER_OTLP_ENDPOINT
 * is unset per app/tracing.py's own startup log), so this is the honest
 * alternative: a small config next to the code, updated by hand when a new
 * service is added, rather than a fake auto-generated diagram. Distinct
 * from ServiceHealthMatrix above it — that shows per-service deploy/health
 * status; this shows how they call each other.
 */
interface ServiceNode {
  name: string;
  kind: "app" | "datastore" | "external";
  callsInto: string[];
}

const SERVICES: ServiceNode[] = [
  { name: "Staff app (matatu-mms)", kind: "app", callsInto: ["Backend API"] },
  { name: "Public app (matatu-mms-public)", kind: "app", callsInto: ["Backend API"] },
  { name: "Ops console (matatu-mms-ops)", kind: "app", callsInto: ["Backend API", "Control plane"] },
  { name: "Backend API", kind: "app", callsInto: ["Postgres", "Redis", "ARQ worker"] },
  { name: "Control plane", kind: "app", callsInto: ["Postgres", "Redis"] },
  { name: "ARQ worker", kind: "app", callsInto: ["Postgres", "Redis", "TomTom API", "GitHub (backups)"] },
  { name: "Postgres", kind: "datastore", callsInto: [] },
  { name: "Redis", kind: "datastore", callsInto: [] },
  { name: "TomTom API", kind: "external", callsInto: [] },
  { name: "GitHub (backups)", kind: "external", callsInto: [] },
];

const KIND_STYLE: Record<ServiceNode["kind"], string> = {
  app: "bg-county-green/10 border-county-green/30 text-county-green",
  datastore: "bg-county-blue/10 border-county-blue/30 text-county-blue",
  external: "bg-black/5 border-black/15 text-black/60",
};

export default function ServiceTopologyGraph() {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Service Dependencies</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Which service calls which — maintained by hand in{" "}
          <code className="font-mono bg-black/5 px-1 rounded">components/ServiceTopologyGraph.tsx</code>, since no
          distributed tracing is deployed to derive this automatically yet.
        </p>
      </div>
      <div className="space-y-2">
        {SERVICES.filter((s) => s.callsInto.length > 0).map((s) => (
          <div key={s.name} className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`badge font-bold border ${KIND_STYLE[s.kind]}`}>{s.name}</span>
            <ArrowRight size={12} className="text-black/30 shrink-0" />
            <div className="flex flex-wrap gap-1.5">
              {s.callsInto.map((target) => {
                const targetNode = SERVICES.find((n) => n.name === target);
                return (
                  <span
                    key={target}
                    className={`badge font-semibold border ${targetNode ? KIND_STYLE[targetNode.kind] : "bg-black/5 border-black/15 text-black/50"}`}
                  >
                    {target}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
