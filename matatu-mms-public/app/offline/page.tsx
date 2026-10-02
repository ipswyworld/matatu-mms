import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Offline" };

/**
 * Shown by the service worker when a navigation fails with no connection
 * (Readiness List §11).
 *
 * Says what still works and what does not, rather than apologising. On a
 * dropped connection the useful information is which of the things you
 * were about to do are worth retrying now.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12 bg-county-cream">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-county-green-deep text-white flex items-center justify-center">
          <WifiOff size={24} strokeWidth={2} />
        </div>

        <h1 className="text-2xl font-black tracking-tight text-county-ink mt-5">
          You&apos;re offline
        </h1>
        <p className="text-sm text-county-ink/60 mt-2">
          This page needs a connection. Your phone will reconnect on its own when signal returns.
        </p>

        <div className="mt-6 text-left rounded-xl border border-black/10 bg-white p-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-black/40">
            Needs a connection
          </h2>
          <ul className="mt-2 space-y-1.5 text-xs text-county-ink/75">
            <li>Booking a seat — availability changes by the second</li>
            <li>Live matatu tracking — a saved position would be wrong</li>
            <li>Paying a fine — never shown from a cache</li>
          </ul>
        </div>

        <p className="text-[11px] text-black/45 mt-5">
          Nothing you submitted while offline was sent. Retry once you have signal.
        </p>
      </div>
    </main>
  );
}
