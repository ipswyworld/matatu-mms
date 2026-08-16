"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";

interface Notification {
  id: string;
  title: string;
  message: string;
  level: "info" | "success" | "error";
  receivedAt: number;
}

interface ActionNeeded {
  count: number;
  message: string;
  href: string;
}

/**
 * Per-user, real-time, name-addressed notifications — connects to this
 * user's own Redis-backed channel (see backend/app/routes/notifications.py),
 * so what arrives here is never visible to anyone else, and arrives the
 * same way regardless of which backend instance triggered it. `actionNeeded`
 * is a separate, pinned entry computed at page load (pending operator
 * approvals) rather than a live WS push, but lives in the same dropdown so
 * there's one place to check instead of a persistent banner on the dashboard.
 */
export default function NotificationBell({ token, actionNeeded }: { token: string; actionNeeded?: ActionNeeded }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toast, setToast] = useState<Notification | null>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled || !token) return;
      const ws = new WebSocket(`${WS_BASE_URL}/api/notifications/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type !== "NOTIFICATION") return;
          const notif: Notification = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: payload.title,
            message: payload.message,
            level: payload.level || "info",
            receivedAt: Date.now(),
          };
          setNotifications((prev) => [notif, ...prev].slice(0, 20));
          setUnread((n) => n + 1);
          setToast(notif);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
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
  }, [token]);

  const levelDot: Record<Notification["level"], string> = {
    info: "bg-county-blue",
    success: "bg-county-green",
    error: "bg-county-red",
  };

  const badgeCount = unread + (actionNeeded?.count || 0);

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setUnread(0);
        }}
        className="relative h-9 w-9 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center transition-colors"
        aria-label="Notifications"
      >
        <span className="text-base">🔔</span>
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-county-red text-white text-[9px] font-bold flex items-center justify-center">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {/* Newest notification stays visible until manually dismissed */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 w-80 bg-white rounded-xl shadow-2xl border border-black/10 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-start gap-2.5">
            <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${levelDot[toast.level]}`} />
            <div className="min-w-0">
              <div className="font-extrabold text-sm text-county-black">{toast.title}</div>
              <p className="text-xs text-black/60 mt-0.5">{toast.message}</p>
            </div>
            <button onClick={() => setToast(null)} className="text-black/30 hover:text-black/60 text-xs ml-auto">✕</button>
          </div>
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-11 w-80 max-h-96 overflow-y-auto bg-white rounded-xl shadow-2xl border border-black/10 z-40">
          <div className="p-3 border-b border-black/5 font-extrabold text-xs uppercase tracking-wider text-black/50">
            Notifications
          </div>

          {actionNeeded && (
            <Link
              href={actionNeeded.href}
              onClick={() => setOpen(false)}
              className="block p-3.5 bg-county-yellow/10 hover:bg-county-yellow/15 border-b border-black/5 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-county-black uppercase tracking-wider">Action needed</span>
                <span className="badge bg-county-yellow text-yellow-900 font-extrabold text-[10px]">{actionNeeded.count}</span>
              </div>
              <p className="text-xs text-black/60 mt-1">{actionNeeded.message}</p>
              <p className="text-[11px] font-bold text-county-green mt-1.5">Go to approvals →</p>
            </Link>
          )}

          {notifications.length === 0 ? (
            <div className="p-6 text-center text-xs text-black/40">Nothing yet — you'll see live updates here.</div>
          ) : (
            <div className="divide-y divide-black/5">
              {notifications.map((n) => (
                <div key={n.id} className="p-3 flex items-start gap-2.5">
                  <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${levelDot[n.level]}`} />
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-county-black">{n.title}</div>
                    <p className="text-[11px] text-black/60 mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-black/30 mt-1">{new Date(n.receivedAt).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
