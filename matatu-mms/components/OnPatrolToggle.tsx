"use client";

import { useEffect, useRef, useState } from "react";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";

interface OnPatrolToggleProps {
  officerId: string;
  token: string;
}

/**
 * Opt-in GPS broadcast for an enforcement officer on patrol — the "On
 * Patrol" toggle beats.py's own earlier docstring flagged as the real
 * product decision blocking live officer tracking (continuous background
 * tracking vs. a foreground screen the officer explicitly turns on).
 *
 * Deliberately no simulated-fallback position: faking an officer's location
 * would actively mislead a commander about where someone actually is. If the
 * device GPS fix isn't available, this shows "GPS unavailable" and broadcasts
 * nothing. The crew/vehicle channel (CrewPortalClient.tsx) used to be the
 * exception here, falling back to simulated movement; it no longer does, for
 * the same reason — a fabricated vehicle position reaches the public
 * passenger map indistinguishable from a real one.
 */
export default function OnPatrolToggle({ officerId, token }: OnPatrolToggleProps) {
  const [onPatrol, setOnPatrol] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "acquiring" | "live" | "unavailable">("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!onPatrol || !token) return;
    let cancelled = false;
    let attempt = 0;

    const send = (lat: number, lng: number, bearing: number, speed: number) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ lat, lng, bearing, speed }));
      }
    };

    const startWatch = () => {
      if (!("geolocation" in navigator)) {
        setGpsStatus("unavailable");
        return;
      }
      setGpsStatus("acquiring");
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsStatus("live");
          send(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.heading || 0,
            Math.round((pos.coords.speed || 0) * 3.6)
          );
        },
        () => setGpsStatus("unavailable"),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
      );
    };

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(`${WS_BASE_URL}/api/telemetry/ws/officer/${officerId}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        startWatch();
      };
      ws.onclose = () => {
        if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        attempt += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      wsRef.current?.close();
      setGpsStatus("idle");
    };
  }, [onPatrol, officerId, token]);

  const statusLabel =
    gpsStatus === "live" ? "On Patrol — GPS Live" :
    gpsStatus === "acquiring" ? "Acquiring GPS…" :
    gpsStatus === "unavailable" ? "GPS unavailable" :
    "Off patrol";

  const dotColor =
    gpsStatus === "live" ? "#068930" : gpsStatus === "acquiring" ? "#F5C518" : gpsStatus === "unavailable" ? "#B4232C" : "#9CA3AF";

  return (
    <div className="flex items-center gap-3 bg-black/5 rounded-lg px-3.5 py-2.5 border border-black/5">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {onPatrol && gpsStatus !== "unavailable" && (
          <span
            className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: dotColor }}
          />
        )}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
      </span>
      <span className="text-xs font-bold text-county-black flex-1">{statusLabel}</span>
      <button
        type="button"
        onClick={() => setOnPatrol((v) => !v)}
        className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
          onPatrol ? "bg-county-red text-white hover:bg-county-red/90" : "bg-county-green text-white hover:bg-county-green-dark"
        }`}
      >
        {onPatrol ? "Go Off Patrol" : "Go On Patrol"}
      </button>
    </div>
  );
}
