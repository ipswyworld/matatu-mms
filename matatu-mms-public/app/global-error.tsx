"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { reportClientError } from "@/lib/reportClientError";

// Only global-error.tsx can catch a crash in the root layout itself
// (error.tsx can't — it renders inside that same layout). It needs its own
// <html>/<body> since the root layout that would normally provide them is
// exactly what just failed.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "system-ui, sans-serif" }}>
          <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Something broke down</h1>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
              The system hit an unexpected fault. This has been logged.
            </p>
            <button
              onClick={() => reset()}
              style={{ background: "#068930", color: "white", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 700, cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
