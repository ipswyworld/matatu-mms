"use client";

import { useEffect, useRef, useState } from "react";
import type { TomTomMap as TomTomMapType } from "@tomtom-org/maps-sdk/map";
import type { Marker as MaplibreMarker } from "maplibre-gl";
import { Stage } from "@/lib/types";

export const NAIROBI_STAGES: Stage[] = [
  { id: "stg-1", name: "Kencom / City Hall Terminal", code: "CBD-KNC", zone: "CBD Zone", lat: -1.2864, lng: 36.8228 },
  { id: "stg-2", name: "Odeon Cinema Stage", code: "CBD-ODN", zone: "CBD Zone", lat: -1.2831, lng: 36.8249 },
  { id: "stg-3", name: "Railways Station Terminus", code: "CBD-RLW", zone: "CBD Zone", lat: -1.2901, lng: 36.8272 },
  { id: "stg-4", name: "Westlands Terminal (Sarit)", code: "WST-SRT", zone: "Westlands Corridor", lat: -1.2618, lng: 36.8049 },
  { id: "stg-5", name: "Ongata Rongai Main Stage", code: "RNG-RNG", zone: "Langata/Rongai Corridor", lat: -1.3963, lng: 36.7593 },
  { id: "stg-6", name: "Kasarani Malls Stage", code: "KSR-KSR", zone: "Thika Superhighway", lat: -1.2217, lng: 36.8974 },
  { id: "stg-7", name: "Umoja 1 Market Terminus", code: "UMJ-UMJ", zone: "Eastlands Trunk", lat: -1.2892, lng: 36.8831 },
];

// TomTom (MapLibre-based) takes center as [lng, lat].
const NAIROBI_CBD_CENTER: [number, number] = [36.8228, -1.2864];

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";
const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

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

function stageMarkerElement(selected: boolean) {
  const el = document.createElement("div");
  el.style.width = selected ? "20px" : "14px";
  el.style.height = selected ? "20px" : "14px";
  el.style.borderRadius = "50%";
  el.style.background = selected ? "#FCDD07" : "#068930";
  el.style.border = "2px solid #ffffff";
  el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.4)";
  el.style.cursor = "pointer";
  return el;
}

// Builds marker content via createElement/textContent rather than innerHTML.
// reg_number is operator-controlled (set at vehicle registration and bulk
// import) — interpolating it into innerHTML would let an operator run
// script in the browser of every user viewing the live map, including
// county admins. textContent can never be interpreted as markup.
function matatuMarkerElement(reg: string, speed: number) {
  const el = document.createElement("div");
  el.style.background = "#0F47AF";
  el.style.border = "2px solid #FCDD07";
  el.style.borderRadius = "8px";
  el.style.padding = "3px 6px";
  el.style.fontSize = "10px";
  el.style.fontWeight = "800";
  el.style.color = "white";
  el.style.whiteSpace = "nowrap";
  el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.4)";
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.alignItems = "center";
  el.style.lineHeight = "1.2";

  const regLabel = document.createElement("span");
  regLabel.className = "matatu-marker-reg";
  regLabel.textContent = `🚐 ${reg}`;

  const speedLabel = document.createElement("span");
  speedLabel.className = "matatu-marker-speed";
  speedLabel.style.color = "#FCDD07";
  speedLabel.style.fontSize = "9px";
  speedLabel.textContent = `${speed} km/h`;

  el.appendChild(regLabel);
  el.appendChild(speedLabel);
  return el;
}

export default function GisMap({ selectedStageId, onSelectStage }: GisMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TomTomMapType | null>(null);
  const vehicleMarkersRef = useRef<Record<string, MaplibreMarker>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "live" | "offline">("connecting");

  // Initialize the TomTom map once
  useEffect(() => {
    if (!TOMTOM_API_KEY) return;
    let destroyed = false;

    (async () => {
      const [{ TomTomConfig }, { TomTomMap }, maplibregl] = await Promise.all([
        import("@tomtom-org/maps-sdk/core"),
        import("@tomtom-org/maps-sdk/map"),
        import("maplibre-gl"),
      ]);
      if (destroyed || !containerRef.current || mapRef.current) return;

      TomTomConfig.instance.put({ apiKey: TOMTOM_API_KEY });

      const map = new TomTomMap({
        style: "standardDark",
        mapLibre: {
          container: containerRef.current,
          center: NAIROBI_CBD_CENTER,
          zoom: 12,
        },
      });
      mapRef.current = map;

      // The style can finish loading before this listener attaches (the SDK
      // resolves it during construction), so check the already-loaded case
      // directly instead of only relying on the "load" event.
      const setupLayers = () => {
        if (destroyed) return;
        const glMap = map.mapLibreMap;
        if (glMap.getSource("corridor-lines")) return;

        // Dashed corridor lines from the CBD hub to every stage, as one line layer.
        glMap.addSource("corridor-lines", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: NAIROBI_STAGES.filter(
              (stg) => stg.lat !== NAIROBI_CBD_CENTER[1] || stg.lng !== NAIROBI_CBD_CENTER[0]
            ).map((stg) => ({
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: [NAIROBI_CBD_CENTER, [stg.lng, stg.lat]],
              },
            })),
          },
        });
        glMap.addLayer({
          id: "corridor-lines-layer",
          type: "line",
          source: "corridor-lines",
          paint: {
            "line-color": "#FCDD07",
            "line-width": 2,
            "line-opacity": 0.35,
            "line-dasharray": [2, 2],
          },
        });

        NAIROBI_STAGES.forEach((stg) => {
          const el = stageMarkerElement(stg.id === selectedStageId);
          new maplibregl.Marker({ element: el }).setLngLat([stg.lng, stg.lat]).addTo(glMap);

          const popup = new maplibregl.Popup({ closeButton: false, offset: 12 }).setText(`${stg.name} (${stg.code})`);
          el.addEventListener("mouseenter", () => popup.setLngLat([stg.lng, stg.lat]).addTo(glMap));
          el.addEventListener("mouseleave", () => popup.remove());
          el.addEventListener("click", () => onSelectStage && onSelectStage(stg));
        });
      };

      // `mapReady` (the SDK's own documented readiness flag) becomes true on
      // a different, earlier timeline than the underlying MapLibre map's own
      // "load" event/`loaded()` state in this wrapper, so poll it directly
      // rather than relying on an event that doesn't reliably fire here.
      const readyCheck = setInterval(() => {
        if (destroyed) {
          clearInterval(readyCheck);
          return;
        }
        if (map.mapReady) {
          clearInterval(readyCheck);
          setupLayers();
        }
      }, 100);
    })();

    return () => {
      destroyed = true;
      mapRef.current?.mapLibreMap.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time telemetry over WebSocket, with reconnect/backoff (no fake simulated movement)
  useEffect(() => {
    if (!TOMTOM_API_KEY) return;
    let cancelled = false;

    const connect = async () => {
      if (cancelled) return;
      const maplibregl = await import("maplibre-gl");
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
        const glMap = map.mapLibreMap;
        const existing = vehicleMarkersRef.current[v.matatu_id];
        if (existing) {
          existing.setLngLat([v.lng, v.lat]);
          const el = existing.getElement();
          const regLabel = el.querySelector<HTMLElement>(".matatu-marker-reg");
          const speedLabel = el.querySelector<HTMLElement>(".matatu-marker-speed");
          if (regLabel) regLabel.textContent = `🚐 ${v.reg_number}`;
          if (speedLabel) speedLabel.textContent = `${v.speed} km/h`;
        } else {
          const marker = new maplibregl.Marker({ element: matatuMarkerElement(v.reg_number, v.speed) })
            .setLngLat([v.lng, v.lat])
            .addTo(glMap);
          const popup = new maplibregl.Popup({ closeButton: false, offset: 12 }).setText(
            `Route ${v.route_code} · ${v.speed} km/h`
          );
          const el = marker.getElement();
          el.addEventListener("mouseenter", () => popup.setLngLat([v.lng, v.lat]).addTo(glMap));
          el.addEventListener("mouseleave", () => popup.remove());
          vehicleMarkersRef.current[v.matatu_id] = marker;
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "INIT_TELEMETRY" && Array.isArray(payload.vehicles)) {
            payload.vehicles.forEach(upsertVehicle);
          } else if (payload.type === "VEHICLE_POSITION_UPDATE" && payload.vehicle) {
            upsertVehicle(payload.vehicle);
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

  const dotColor =
    connectionStatus === "live" ? "#068930" : connectionStatus === "connecting" ? "#F5C518" : "#B4232C";

  return (
    <div className="rounded-2xl overflow-hidden relative border border-white/10 shadow-2xl">
      {!TOMTOM_API_KEY ? (
        <div className="h-[380px] flex items-center justify-center bg-county-black text-white/50 text-xs font-semibold px-6 text-center">
          Set NEXT_PUBLIC_TOMTOM_API_KEY to enable the live map.
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-[380px]" />
      )}
      {TOMTOM_API_KEY && (
        <span className="absolute top-3 right-3 flex h-2.5 w-2.5 z-10">
          {connectionStatus !== "offline" && (
            <span
              className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ backgroundColor: dotColor }}
            />
          )}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
        </span>
      )}
    </div>
  );
}
