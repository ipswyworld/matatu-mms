"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveVehicleTelemetry } from "@/components/GisMap";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";

/**
 * Live vehicle positions keyed by matatu_id, independent of GisMap's own
 * WebSocket connection to the same public /ws/passengers feed — each
 * component that needs live telemetry opens its own connection, same
 * pattern as LiveUpdatesModal's map and CrewPortalClient's GPS stream.
 * Used for client-side distance/ETA (lib/geo.ts) since the backend never
 * needs to know a passenger's location to compute it.
 */
export function useLiveVehicles() {
  const [vehicles, setVehicles] = useState<Record<string, LiveVehicleTelemetry>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(`${WS_BASE_URL}/api/telemetry/ws/passengers`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
      };

      const upsert = (v: LiveVehicleTelemetry) => {
        setVehicles((prev) => ({ ...prev, [v.matatu_id]: v }));
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "INIT_TELEMETRY" && Array.isArray(payload.vehicles)) {
            payload.vehicles.forEach(upsert);
          } else if (payload.type === "VEHICLE_POSITION_UPDATE" && payload.vehicle) {
            upsert(payload.vehicle);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        attempt += 1;
        reconnectTimeout = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      wsRef.current?.close();
    };
  }, []);

  return vehicles;
}
