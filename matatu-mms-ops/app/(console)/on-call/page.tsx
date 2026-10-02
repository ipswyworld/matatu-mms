import type { Metadata } from "next";
import { Phone, Pencil } from "lucide-react";
import { ON_CALL_DIRECTORY } from "@/lib/onCall";

export const metadata: Metadata = { title: "On-Call | Ops Console" };

export default function OnCallPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink flex items-center gap-2">
          <Phone size={20} strokeWidth={2} />
          On-Call & Escalation
        </h1>
        <p className="text-xs text-black/50 mt-0.5">
          Who to contact during an incident. Maintained by hand in <code className="font-mono bg-black/5 px-1 rounded">lib/onCall.ts</code>.
        </p>
      </div>

      <div className="card p-5">
        {ON_CALL_DIRECTORY.length === 0 ? (
          <div className="text-xs text-black/50 flex items-start gap-2">
            <Pencil size={14} className="shrink-0 mt-0.5 text-amber-600" />
            <span>
              No on-call contacts configured yet. This is intentionally empty rather than filled with placeholder
              names — edit <code className="font-mono bg-black/5 px-1 rounded">matatu-mms-ops/lib/onCall.ts</code>{" "}
              with the real escalation list before relying on this page during an incident.
            </span>
          </div>
        ) : (
          <div className="divide-y divide-black/5">
            {ON_CALL_DIRECTORY.map((c, i) => (
              <div key={i} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-sm text-county-black">{c.role}</p>
                  <p className="text-xs text-black/60">{c.name}</p>
                  {c.notes && <p className="text-[11px] text-black/40 mt-0.5">{c.notes}</p>}
                </div>
                <a href={`tel:${c.phone}`} className="text-xs font-bold text-county-green hover:underline shrink-0">
                  {c.phone}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
