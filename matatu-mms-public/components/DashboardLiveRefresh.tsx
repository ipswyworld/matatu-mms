"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LiveIndicator from "./LiveIndicator";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";

/**
 * Makes the dashboard panels actually live, not just "live as of your last
 * refresh": subscribes to a lightweight event ping and calls router.refresh()
 * to re-fetch the server component's data (bookings, fines, fleet status,
 * approvals) whenever anything relevant happens anywhere in the system.
 */
export default function DashboardLiveRefresh({ token }: { token: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"live" | "connecting" | "offline">("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled || !token) return;
      setStatus("connecting");
      const ws = new WebSocket(`${WS_BASE_URL}/api/events/ws/dashboard?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setStatus("live");
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "DASHBOARD_UPDATE") {
            router.refresh();
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus("offline");
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 15000);
        reconnectAttemptRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [token, router]);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2">
      <LiveIndicator
        label={status === "live" ? "Live updates on" : status === "connecting" ? "Connecting…" : "Reconnecting…"}
        state={status}
        className="text-county-yellow text-[10px]"
      />
    </div>
  );
}
