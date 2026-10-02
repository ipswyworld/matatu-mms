// Reports a browser-side crash (Next.js error.tsx/global-error.tsx boundary)
// to the backend so it shows up in the ops console's live stream within
// seconds — not just in Sentry, which is inert in this deployment (no DSN
// configured) and, even when it is, has no path into the ops console on
// its own. Fire-and-forget: a failed report must never block or throw
// inside an already-crashed page.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";

export function reportClientError(error: Error & { digest?: string }) {
  try {
    fetch(`${BACKEND_URL}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        app: "matatu-mms",
        message: error.message || "Unknown error",
        url: typeof window !== "undefined" ? window.location.href : "",
        digest: error.digest ?? null,
        stack: error.stack ?? null,
      }),
    }).catch(() => {
      // Best-effort only — a passenger/officer on a bad connection whose
      // crash report itself fails to send should never see a second error.
    });
  } catch {
    // Same reasoning as above, for the synchronous path (e.g. fetch itself
    // throwing rather than rejecting).
  }
}
