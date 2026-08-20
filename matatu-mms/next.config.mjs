import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Security headers (ARCHITECTURE_DECISIONS.md §15.4) — applied here so
// they're present regardless of deploy path. nginx/nginx.conf already sets
// these for the self-hosted docker-compose stack, but Render's actual live
// deployment (render.yaml) serves this app directly, bypassing that nginx
// layer entirely — without this, the live demo shipped with none of them.
//
// CSP is real but deliberately not maximally strict: this app loads TomTom
// map tiles/SDK assets and reports to Sentry, both from domains not
// hardcoded anywhere in this codebase (configured via env/the SDK
// internally), so a byte-for-byte allowlist can't be derived by
// inspection alone and risks silently breaking the map or error reporting
// without a live browser check to verify against — not something to ship
// unverified. `script-src 'self'` is the load-bearing rule here (blocks
// injected inline scripts, the structural mitigation for §15.3's XSS
// findings); img-src/connect-src stay at `https:` broadly for the map
// tile/Sentry domains. Tightening those two to an exact allowlist is real
// follow-up work once verified live.
// Next dev mode's webpack runtime wraps every module in eval() for fast
// HMR rebuilds (the `devtool: 'eval-source-map'` default) — without
// 'unsafe-eval' in script-src, the browser silently blocks that eval and
// the entire client bundle fails to execute. React never hydrates: the
// server-rendered HTML looks fine, but every onClick/useEffect is dead
// (confirmed live — zero React fiber on any DOM node, zero WebSocket
// connections ever opened). Production builds don't eval like this, so
// this only needs relaxing for `next dev`, never for what actually ships.
const SCRIPT_SRC = process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

// The backend runs on plain http://127.0.0.1:8000 in local dev (no TLS
// cert for localhost) — without allowing plain http:/ws: here too, every
// client-side fetch/WebSocket to it is silently blocked by CSP while the
// server-rendered HTML looks fine (same gap already fixed in
// matatu-mms-public/next.config.mjs; the deployed prod backend is always
// https, so this only needs relaxing for `next dev`).
const CONNECT_SRC = process.env.NODE_ENV === "production" ? "connect-src 'self' https: wss:" : "connect-src 'self' https: http: wss: ws:";

const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      SCRIPT_SRC,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      CONNECT_SRC,
      // maplibre-gl (used by the TomTom map SDK) fetches and parses vector
      // tiles inside a Web Worker instantiated from a blob: URL. CSP has no
      // dedicated worker-src fallback chain entry here otherwise, so it
      // falls back to script-src, which doesn't allow blob: — the worker
      // silently fails to spawn, the tile-loading pipeline never runs, and
      // the map renders style/background/markers but zero tiles, on both
      // Render and localhost since the header is identical in both. No
      // console exception either: the browser reports this as a native CSP
      // violation, not a thrown JS error.
      "worker-src 'self' blob:",
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
  // @tomtom-org/maps-sdk does `import { version } from "maplibre-gl/package.json"`,
  // which Next's default webpack config doesn't resolve as a named JSON
  // export. Routing it through Next's own transform pipeline fixes the
  // interop instead of leaving it as a pre-built external module.
  transpilePackages: ["@tomtom-org/maps-sdk"],
  webpack: (config) => {
    config.resolve.alias["maplibre-gl/package.json$"] = path.resolve(__dirname, "lib/maplibre-version-shim.js");
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

// Sentry's webpack plugin uploads source maps on build so stack traces
// resolve to real source instead of minified bundles — that upload needs
// SENTRY_AUTH_TOKEN, which isn't configured here. Without it the plugin
// silently skips the upload rather than failing the build; runtime error
// capture (sentry.*.config.ts) works either way.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  webpack: { treeshake: { removeDebugLogging: true } },
});
