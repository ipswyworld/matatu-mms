// This app embeds Grafana in an iframe (see app/page.tsx). The comment this
// replaced assumed it's reached only through the nginx :3002 block or a
// network-restricted deploy — true for the self-hosted docker-compose
// target, but not for Render, which has no network-layer isolation for this
// service (§Network Engineering, Cross-Cutting Theme #3): it's reachable at
// its own public URL, protected only by the app's own SUPERADMIN-only
// session check. A stricter production script-src without 'unsafe-inline'
// was never actually exercised against that deployment — confirmed live:
// it blocks Next.js's own required inline hydration scripts entirely,
// leaving a blank page after login (React error #423) on every real
// browser test. Matches the staff and public apps' existing script-src now.
const SCRIPT_SRC = process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";

const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      SCRIPT_SRC,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      // Grafana is embedded same-origin via nginx's /grafana/ location in
      // production; 'self' covers that. Local dev without nginx points
      // GRAFANA_EMBED_URL at a different origin, so allow http(s) broadly
      // there rather than hardcoding a dev-only host into frame-src.
      process.env.NODE_ENV === "production" ? "frame-src 'self'" : "frame-src 'self' http: https:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
