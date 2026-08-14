// Server-side (Node runtime) error tracking — catches errors in Server
// Components, Server Actions, and Route Handlers. Inert with no config
// required; set SENTRY_DSN to start receiving them.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
  });
}
