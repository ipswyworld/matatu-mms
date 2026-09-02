"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Registers the service worker and shows connection state
 * (Readiness List §11).
 *
 * The offline banner matters more than the caching does. On a variable
 * mobile connection the worst experience is not slowness, it is acting on
 * something that quietly did not happen — tapping "book" with no signal and
 * having no idea whether a seat was reserved. Saying "you are offline"
 * plainly is most of the fix.
 */
export default function ServiceWorkerRegistrar() {
  const [online, setOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    // navigator.onLine only reports whether a network interface exists, not
    // whether anything is reachable — it is optimistic on a connected-but-
    // dead Kenyan mobile link. Treated as a hint, which is why API failures
    // still surface their own errors rather than relying on this.
    setOnline(navigator.onLine);

    const goOnline = () => {
      setOnline(true);
    };
    const goOffline = () => {
      setOnline(false);
      setWasOffline(true);
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      // Production only: in dev the worker would serve stale bundles and
      // make every code change look like it did not apply.
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failing is not worth surfacing — the app works
        // without it, just without offline resilience.
      });
    }

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online && !wasOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-0 inset-x-0 z-50 px-4 py-2.5 text-center text-xs font-bold transition-colors ${
        online ? "bg-county-green text-white" : "bg-county-red text-white"
      }`}
    >
      {online ? (
        <span>Back online. Refresh to see the latest.</span>
      ) : (
        <span className="inline-flex items-center gap-2 justify-center">
          <WifiOff size={13} />
          You are offline. Bookings, payments and live tracking need a connection.
        </span>
      )}
    </div>
  );
}
