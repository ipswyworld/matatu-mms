// This app embeds Grafana in an iframe (see app/page.tsx) and is deliberately
// reached only through the nginx :3002 block (nginx/nginx.conf) or a
// network-restricted deploy — so the CSP here only needs to be strict about
// script/style execution, not about a long allowlist of third-party
// domains the way the public-facing app's does.
const SCRIPT_SRC = process.env.NODE_ENV === "production" ? "script-src 'self'" : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";

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
