import { LogIn, LogOut } from "lucide-react";
import { AuditLog, StaffUser } from "@/lib/types";

/**
 * A filtered view over already-captured IMPERSONATION_START/END audit
 * events (auth.py stages both under resource_type="user") — not new
 * capture, just a focused read the general Audit page doesn't provide.
 * START's resourceId is the impersonation target; END's is the
 * impersonator ending their own session, so these render as two labeled
 * event kinds rather than fused into synthetic "sessions" nothing here
 * actually models as a pairable unit.
 */
export default function ImpersonationLogPanel({ events, staff }: { events: AuditLog[]; staff: StaffUser[] }) {
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name || id;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Impersonation Log</h3>
        <p className="text-xs text-black/50 mt-0.5">Every impersonation start and end, most recent first.</p>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-black/40 italic">No impersonation activity recorded yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 text-[11px] py-1.5 border-b border-black/5 last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                {e.action === "IMPERSONATION_START" ? (
                  <>
                    <LogIn size={12} className="text-amber-700 shrink-0" />
                    <span className="text-black/70">
                      <span className="font-semibold text-county-black">{nameOf(e.userId)}</span> started impersonating{" "}
                      <span className="font-semibold text-county-black">{nameOf(e.resourceId)}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <LogOut size={12} className="text-black/40 shrink-0" />
                    <span className="text-black/70">
                      <span className="font-semibold text-county-black">{nameOf(e.userId)}</span> ended their impersonation session
                    </span>
                  </>
                )}
              </div>
              <span className="text-black/40 shrink-0">{new Date(e.timestamp).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
