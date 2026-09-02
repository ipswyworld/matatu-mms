import { NextRequest } from "next/server";
import { readSession } from "@/lib/session";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

// SSE must not be buffered or statically optimised — Next needs to treat
// this as a live, per-request stream.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events proxy for the ops live feed (Ops Console Rebuild Spec
 * §3.2).
 *
 * The browser's EventSource API cannot attach an Authorization header, and
 * putting a bearer token in the query string would leak it into access logs
 * and browser history. So the browser connects here with nothing but its
 * own session cookie, and this handler — which can read that cookie
 * server-side — opens the upstream connection with the bearer token and
 * pipes the bytes straight through.
 */
export async function GET(request: NextRequest) {
  const session = readSession();
  if (!session?.token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/control/stream`, {
      headers: {
        Authorization: `Bearer ${session.token}`,
        Accept: "text/event-stream",
      },
      cache: "no-store",
      // Closing the browser tab aborts this handler, which must in turn
      // abort the upstream request — otherwise the backend keeps producing
      // snapshots for a client that has gone away.
      signal: request.signal,
    });
  } catch {
    return new Response("Could not reach the control plane", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`Control plane returned ${upstream.status}`, {
      status: upstream.status === 401 || upstream.status === 403 ? upstream.status : 502,
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
