"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";
import { Stage } from "@/lib/types";
import LiveIndicator from "./LiveIndicator";

export const NAIROBI_STAGES: Stage[] = [
  { id: "stg-1", name: "Kencom / City Hall Terminal", code: "CBD-KNC", zone: "CBD Zone", lat: -1.2864, lng: 36.8228 },
  { id: "stg-2", name: "Odeon Cinema Stage", code: "CBD-ODN", zone: "CBD Zone", lat: -1.2831, lng: 36.8249 },
  { id: "stg-3", name: "Railways Station Terminus", code: "CBD-RLW", zone: "CBD Zone", lat: -1.2901, lng: 36.8272 },
  { id: "stg-4", name: "Westlands Terminal (Sarit)", code: "WST-SRT", zone: "Westlands Corridor", lat: -1.2618, lng: 36.8049 },
  { id: "stg-5", name: "Ongata Rongai Main Stage", code: "RNG-RNG", zone: "Langata/Rongai Corridor", lat: -1.3963, lng: 36.7593 },
  { id: "stg-6", name: "Kasarani Malls Stage", code: "KSR-KSR", zone: "Thika Superhighway", lat: -1.2217, lng: 36.8974 },
  { id: "stg-7", name: "Umoja 1 Market Terminus", code: "UMJ-UMJ", zone: "Eastlands Trunk", lat: -1.2892, lng: 36.8831 },
];

const NAIROBI_CBD_CENTER: [number, number] = [-1.2864, 36.8228];

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";

export interface LiveVehicleTelemetry {
  matatu_id: string;
  reg_number: string;
  route_code: string;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
}

interface GisMapProps {
  selectedStageId?: string;
  onSelectStage?: (stage: Stage) => void;
}

function matatuDivIcon(reg: string, speed: number) {
  return `
    <div style="
      background: #0F47AF;
      border: 2px solid #FCDD07;
      border-radius: 8px;
      padding: 3px 6px;
      font-size: 10px;
      font-weight: 800;
      color: white;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: 1.2;
    ">
      <span>🚐 ${reg}</span>
      <span style="color:#FCDD07;font-size:9px;">${speed} km/h</span>
    </div>
  `;
}

export default function GisMap({ selectedStageId, onSelectStage }: GisMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const vehicleMarkersRef = useRef<Record<string, Marker>>({});
  const routeLinesRef = useRef<Polyline[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  const [vehicleCount, setVehicleCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "live" | "offline">("connecting");

  // Initialize the Leaflet map once
  useEffect(() => {
    let destroyed = false;
    let L: typeof import("leaflet");

    (async () => {
      L = (await import("leaflet")).default;
      if (destroyed || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView(NAIROBI_CBD_CENTER, 12);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      // Nairobi County stage markers + corridor lines from CBD hub
      const hub = L.latLng(NAIROBI_CBD_CENTER);
      NAIROBI_STAGES.forEach((stg) => {
        const isSelected = stg.id === selectedStageId;
        const marker = L.circleMarker([stg.lat, stg.lng], {
          radius: isSelected ? 10 : 7,
          fillColor: isSelected ? "#FCDD07" : "#068930",
          color: "#ffffff",
          weight: 2,
          fillOpacity: 0.9,
        }).addTo(map);
        marker.bindTooltip(`${stg.name} (${stg.code})`, { direction: "top" });
        marker.on("click", () => onSelectStage && onSelectStage(stg));

        if (stg.lat !== hub.lat || stg.lng !== hub.lng) {
          const line = L.polyline([hub, [stg.lat, stg.lng]], {
            color: "#FCDD07",
            weight: 2,
            opacity: 0.35,
            dashArray: "6 6",
          }).addTo(map);
          routeLinesRef.current.push(line);
        }
      });

      mapRef.current = map;
    })();

    return () => {
      destroyed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight selected stage without re-initializing the whole map
  useEffect(() => {
    // handled visually on next full mount; kept intentionally simple for this prototype
  }, [selectedStageId]);

  // Real-time telemetry over WebSocket, with reconnect/backoff (no fake simulated movement)
  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      if (cancelled) return;
      const L = (await import("leaflet")).default;
      setConnectionStatus("connecting");

      const ws = new WebSocket(`${WS_BASE_URL}/api/telemetry/ws/passengers`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionStatus("live");
      };

      const upsertVehicle = (v: LiveVehicleTelemetry) => {
        const map = mapRef.current;
        if (!map) return;
        const existing = vehicleMarkersRef.current[v.matatu_id];
        if (existing) {
          existing.setLatLng([v.lat, v.lng]);
          existing.setIcon(
            L.divIcon({ html: matatuDivIcon(v.reg_number, v.speed), className: "", iconSize: [0, 0] })
          );
        } else {
          const marker = L.marker([v.lat, v.lng], {
            icon: L.divIcon({ html: matatuDivIcon(v.reg_number, v.speed), className: "", iconSize: [0, 0] }),
          }).addTo(map);
          marker.bindTooltip(`Route ${v.route_code} · ${v.speed} km/h`, { direction: "top" });
          vehicleMarkersRef.current[v.matatu_id] = marker;
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "INIT_TELEMETRY" && Array.isArray(payload.vehicles)) {
            payload.vehicles.forEach(upsertVehicle);
            setVehicleCount(payload.vehicles.length);
          } else if (payload.type === "VEHICLE_POSITION_UPDATE" && payload.vehicle) {
            upsertVehicle(payload.vehicle);
            setVehicleCount(Object.keys(vehicleMarkersRef.current).length);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnectionStatus("offline");
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 15000);
        reconnectAttemptRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  const statusLabel =
    connectionStatus === "live"
      ? `${vehicleCount} Live Vehicles Streaming`
      : connectionStatus === "connecting"
      ? "Connecting to telemetry…"
      : "Offline — retrying…";

  return (
    <div className="bg-county-black rounded-2xl p-5 text-white shadow-2xl relative overflow-hidden select-none border border-white/10 space-y-3">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <h3 className="font-extrabold text-sm tracking-wide text-white uppercase">
            Nairobi Live Matatu GPS Telemetry Map
          </h3>
          <p className="text-[11px] text-white/60">Real WebSocket GPS feed — no simulated movement</p>
        </div>
        <div className="flex items-center gap-2 text-xs bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
          <LiveIndicator label={statusLabel} state={connectionStatus === "live" ? "live" : connectionStatus === "connecting" ? "connecting" : "offline"} className="text-county-yellow" />
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full h-[380px] rounded-xl border border-white/10 overflow-hidden z-0"
      />

      <div className="flex flex-wrap gap-4 justify-between items-center text-xs pt-1 text-white/70">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-md bg-county-blue border border-white" />
            <span>Live Matatu</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-county-green" />
            <span>Bus Terminus</span>
          </div>
        </div>
        <div className="text-[10px] text-white/40 font-mono">Telemetry Pipeline: WebSocket Pub/Sub</div>
      </div>
    </div>
  );
}
