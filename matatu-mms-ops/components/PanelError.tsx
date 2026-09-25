import { AlertTriangle } from "lucide-react";

/**
 * Degraded-mode rendering for one panel (Ops Console Rebuild Spec §21.4).
 *
 * A console that fails to paint has failed at its only job, so no single
 * unreachable data source may take a whole page down. Each panel's fetch is
 * isolated and renders this in place of the panel on failure, leaving every
 * other panel — including the controls that fix the problem — usable.
 */
export default function PanelError({ title, error }: { title: string; error: string }) {
  return (
    <div className="card p-5 border-amber-300 bg-amber-50/60">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="font-bold text-sm text-amber-900">{title} unavailable</h3>
          <p className="text-xs text-amber-800/80 mt-1 break-words">{error}</p>
          <p className="text-[11px] text-amber-800/60 mt-1.5">
            The rest of this page still works. Reload once the underlying service recovers.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Resolves a panel's data, converting failure into a renderable message
 *  rather than an exception that unmounts the page. */
export async function settle<T>(promise: Promise<T>): Promise<{ data?: T; error?: string }> {
  try {
    return { data: await promise };
  } catch (err: any) {
    // next/navigation's redirect() (thrown by apiFetch on a 401/403 to send
    // an expired session to /login) works by throwing a special error for
    // Next's own rendering pipeline to catch. Swallowing it here like an
    // ordinary error turns a redirect into literal "NEXT_REDIRECT" text on
    // the page instead of an actual navigation — it must always propagate.
    if (err?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    return { error: err?.message || "Could not load this data." };
  }
}
