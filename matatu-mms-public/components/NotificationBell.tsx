"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { refreshSessionAction, markNotificationsReadAction } from "@/lib/actions";
import { AppNotification } from "@/lib/types";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";

// Well under the backend's 60-minute access-token expiry (ACCESS_TOKEN_EXPIRE_MINUTES)
// — refreshing proactively means the WS should rarely if ever hit the 4401
// path below during normal use, not just recover from it after the fact.
const TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

// How many of the merged (history + live) items to actually render — the
// server-side history fetch already caps at 50; this just keeps the
// dropdown itself from growing unbounded within one long-lived session.
const DISPLAY_LIMIT = 30;

interface ActionNeeded {
  count: number;
  message: string;
  href: string;
}

/**
 * Per-user, real-time, name-addressed notifications — connects to this
 * user's own Redis-backed channel (see backend/app/routes/notifications.py),
 * so what arrives here is never visible to anyone else, and arrives the
 * same way regardless of which backend instance triggered it.
 *
 * Two independent badges, not one summed number: `actionNeeded` (yellow,
 * pending operator approvals — recomputed from real DB state on every
 * page load, clears itself once the underlying thing is resolved) and
 * unread notifications (red, sourced from `Notification.read_at` in the
 * backend — persists across reconnects and reloads, and only actually
 * clears when `/api/notifications/read` is called, not just by opening
 * the dropdown and having the client forget). Folding both into one
 * number used to mean a commander seeing "3" had no way to tell how many
 * were approvals versus already-seen noise.
 *
 * History: `initialItems`/`initialUnreadCount` come from the server
 * component that renders this (a real fetch against `/api/notifications`
 * at page load), so a refresh no longer empties the list — only what
 * arrived over the WebSocket used to survive here.
 *
 * Token lifecycle: the access token embedded in the session cookie expires
 * after 60 minutes, but the cookie itself lasts 8 hours (30 days with
 * "remember me"). Without proactively refreshing, this socket — and every
 * other authenticated call in the app — would silently start failing an
 * hour into any normal session while the UI still looks logged in. This
 * component refreshes the token on a timer well before it expires, and
 * falls back to an immediate refresh-and-reconnect if the socket is ever
 * actually rejected for an expired one (code 4401), rather than retrying
 * the same known-bad token forever.
 */
export default function NotificationBell({
  token: initialToken,
  actionNeeded,
  initialItems,
  initialUnreadCount,
}: {
  token: string;
  actionNeeded?: ActionNeeded;
  initialItems: AppNotification[];
  initialUnreadCount: number;
}) {
  const [token, setToken] = useState(initialToken);
  const [items, setItems] = useState<AppNotification[]>(initialItems);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [open, setOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  // Proactive refresh, independent of whether the socket is even connected
  // right now — every other authenticated fetch in the app benefits from
  // the cookie staying fresh too, not just this WebSocket.
  useEffect(() => {
    const interval = setInterval(async () => {
      const result = await refreshSessionAction();
      if (result.accessToken) setToken(result.accessToken);
    }, TOKEN_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const scheduleReconnect = () => {
      const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 15000);
      reconnectAttemptRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

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
          const notif: AppNotification = {
            id: payload.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: payload.title,
            message: payload.message,
            level: payload.level || "info",
            // Deliberately not "type" on the wire — that key is the
            // transport envelope's own discriminator ({"type": "NOTIFICATION"}),
            // so the backend sends this under "notificationType" instead.
            type: payload.notificationType,
            createdAt: payload.createdAt || new Date().toISOString(),
            readAt: null,
          };
          setItems((prev) => [notif, ...prev].slice(0, DISPLAY_LIMIT));
          setUnreadCount((n) => n + 1);
          setToast(notif);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = (event) => {
        if (cancelled) return;
        // The backend now actually delivers this code (it used to collapse
        // into a generic HTTP 403 pre-handshake — fixed in
        // routes/notifications.py) — an expired/invalid token gets one
        // immediate refresh-and-reconnect instead of retrying the same
        // dead token on a blind backoff loop forever.
        if (event.code === 4401) {
          refreshSessionAction().then((result) => {
            if (cancelled) return;
            if (result.accessToken) {
              reconnectAttemptRef.current = 0;
              setToken(result.accessToken);
            } else {
              // Refresh itself failed (session genuinely too old/revoked)
              // — nothing left to do client-side; fall back to backoff so
              // this doesn't spin tightly, though it'll keep failing until
              // the user actually re-logs in.
              scheduleReconnect();
            }
          });
          return;
        }
        scheduleReconnect();
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

  const levelDot: Record<AppNotification["level"], string> = {
    info: "bg-county-blue",
    success: "bg-county-green",
    error: "bg-county-red",
  };

  // Distinct glyphs for the two Phase 6 alert types, layered over the
  // existing level dot rather than replacing it — level still carries
  // color/urgency, this just adds "what kind of thing is this."
  const typeIcon: Record<string, string> = {
    NO_SHOW_WARNING: "⏱",
    REASSIGNMENT_ALERT: "🚌",
  };
  const iconFor = (n: AppNotification) => (n.type ? typeIcon[n.type] : undefined);

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      const now = new Date().toISOString();
      // Optimistic: reflect "read" immediately rather than waiting on the
      // round trip, since this is exactly the kind of thing that should
      // never visibly lag behind the click that caused it.
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      setUnreadCount(0);
      markNotificationsReadAction().then((result) => {
        // Reconcile with the server's real count in case something
        // else (another tab, a live push that arrived mid-request)
        // changed it — the optimistic 0 above is a UI convenience, not
        // the source of truth.
        if (typeof result.unreadCount === "number") setUnreadCount(result.unreadCount);
      });
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className="relative h-9 w-9 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center transition-colors"
        aria-label="Notifications"
      >
        <span className="text-base">🔔</span>
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-county-red text-white text-[9px] font-bold flex items-center justify-center"
            title={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        {actionNeeded && actionNeeded.count > 0 && (
          <span
            className="absolute -bottom-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-county-yellow text-yellow-900 text-[9px] font-bold flex items-center justify-center ring-1 ring-white"
            title={`${actionNeeded.count} action${actionNeeded.count === 1 ? "" : "s"} needed`}
          >
            {actionNeeded.count > 9 ? "9+" : actionNeeded.count}
          </span>
        )}
      </button>

      {/* Newest notification stays visible until manually dismissed */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 w-80 bg-white rounded-xl shadow-2xl border border-black/10 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-start gap-2.5">
            {iconFor(toast) ? (
              <span className="text-sm mt-0.5 shrink-0">{iconFor(toast)}</span>
            ) : (
              <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${levelDot[toast.level]}`} />
            )}
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

          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-black/40">Nothing yet — you'll see updates here.</div>
          ) : (
            <div className="divide-y divide-black/5">
              {items.map((n) => (
                <div key={n.id} className={`p-3 flex items-start gap-2.5 ${n.readAt ? "" : "bg-county-blue/[0.04]"}`}>
                  {iconFor(n) ? (
                    <span className="text-sm mt-0.5 shrink-0">{iconFor(n)}</span>
                  ) : (
                    <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${levelDot[n.level]}`} />
                  )}
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-county-black">{n.title}</div>
                    <p className="text-[11px] text-black/60 mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-black/30 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
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
