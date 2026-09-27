import { headers } from "next/headers";

/**
 * The real end-visitor's IP, read from the incoming request's own headers
 * (which DO pass through Render's Cloudflare edge, unlike this server's
 * own outbound fetch to the backend, which is a purely internal
 * server-to-server call with no such headers of its own). Forwarded
 * explicitly on every backend call so app/client_ip.py's rate limiter
 * doesn't collapse every operator into the internal container's single
 * shared IP — see that module's own docstring for the exact bug this
 * fixes ("the third attempt at the same bug"), first found via the public
 * app's own login lockouts and applied here too since this app calls the
 * same backend the same way.
 */
export function forwardedClientIpHeaders(): Record<string, string> {
  try {
    const h = headers();
    const out: Record<string, string> = {};
    const cf = h.get("cf-connecting-ip");
    const xff = h.get("x-forwarded-for");
    const realIp = h.get("x-real-ip");
    if (cf) out["CF-Connecting-IP"] = cf;
    if (xff) out["X-Forwarded-For"] = xff;
    if (realIp) out["X-Real-IP"] = realIp;
    return out;
  } catch {
    // headers() throws outside an active request context (e.g. if ever
    // called from a background job) — never let that break the actual call.
    return {};
  }
}
