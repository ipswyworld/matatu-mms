"use client";

import { useEffect, useRef, useState } from "react";
import type { OpsSnapshot } from "./types";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "failed";

/**
 * Subscribes to the ops live feed (Ops Console Rebuild Spec §3.2).
 *
 * Seeded with the server-rendered snapshot so a page paints complete data
 * immediately and then goes live, rather than flashing empty while the
 * first event arrives.
 *
 * EventSource reconnects on its own, but it retries forever and silently.
 * That is wrong for this console: an operator must be able to tell the
 * difference between "the system is quiet" and "this page stopped
 * receiving updates ten minutes ago". So connection state is surfaced,
 * and after a bounded number of failures the hook gives up loudly rather
 * than leaving a stale snapshot on screen looking authoritative.
 */
export function useOpsStream(initial: OpsSnapshot | null) {
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(initial);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  // Seeded null, not Date.now(): calling Date.now() as a useState initializer
  // runs it once during the server render and again during client hydration,
  // producing two different timestamps and a React hydration-mismatch error
  // (#418/#423/#425) on every load. Setting the real value only inside the
  // effect below — which never runs during SSR — guarantees the server
  // output and the first client render agree (both null; StreamBadge
  // already renders nothing until lastEventAt is set).
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const failuresRef = useRef(0);

  useEffect(() => {
    if (initial) setLastEventAt(Date.now());

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const MAX_FAILURES = 6;

    function connect() {
      if (cancelled) return;
      source = new EventSource("/api/stream");

      source.addEventListener("open", () => {
        failuresRef.current = 0;
        setStatus("live");
      });

      source.addEventListener("snapshot", (event) => {
        try {
          setSnapshot(JSON.parse((event as MessageEvent).data) as OpsSnapshot);
          setLastEventAt(Date.now());
          setStatus("live");
        } catch {
          // A malformed frame is not worth tearing the connection down for;
          // the next tick (3s later) supersedes it anyway.
        }
      });

      source.addEventListener("error", () => {
        source?.close();
        source = null;
        if (cancelled) return;

        failuresRef.current += 1;
        if (failuresRef.current >= MAX_FAILURES) {
          setStatus("failed");
          return;
        }
        setStatus("reconnecting");
        // Exponential backoff, capped — a control plane that is down stays
        // down for a while, and hammering it does not help.
        const delay = Math.min(1000 * 2 ** (failuresRef.current - 1), 15000);
        retryTimer = setTimeout(connect, delay);
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, []);

  return { snapshot, status, lastEventAt };
}
