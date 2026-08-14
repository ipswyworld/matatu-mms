import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
