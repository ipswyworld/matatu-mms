// Next.js instrumentation hook — loads the right Sentry config for whichever
// runtime this process is (Node server vs. Edge middleware). Both configs
// are themselves inert unless a DSN is set, so this is a no-op by default.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (...args: Parameters<NonNullable<typeof import("@sentry/nextjs").captureRequestError>>) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(...args);
};
