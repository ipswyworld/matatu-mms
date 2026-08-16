"use client";

import { useEffect, useRef, useState } from "react";
import type { TomTomMap as TomTomMapType } from "@tomtom-org/maps-sdk/map";
import type { Marker as MaplibreMarker } from "maplibre-gl";
import { Beat, Zone } from "@/lib/types";
import type { LiveVehicleTelemetry, LiveOfficerTelemetry } from "@/lib/data";

// TomTom (MapLibre-based) takes center as [lng, lat].
const NAIROBI_CBD_CENTER: [number, number] = [36.8228, -1.2864];

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";
const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

// A small fixed palette keyed by zone id — stable across reloads so a
// given corridor always reads as the same color rather than shuffling.
const ZONE_COLORS = ["#068930", "#0F47AF", "#F5C518", "#B4232C", "#7C3AED", "#0891B2"];

function zoneColor(zoneId: string | null | undefined, zoneOrder: string[]): string {
  if (!zoneId) return "#9CA3AF";
  const idx = zoneOrder.indexOf(zoneId);
  return ZONE_COLORS[idx % ZONE_COLORS.length] || "#9CA3AF";
}

function officerMarkerElement(name: string, role: string) {
  const el = document.createElement("div");
  el.style.background = "#B4232C";
  el.style.border = "2px solid #ffffff";
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

  const nameLabel = document.createElement("span");
  nameLabel.className = "officer-marker-name";
  nameLabel.textContent = `\u{1F46E} ${name}`;

  const roleLabel = document.createElement("span");
  roleLabel.className = "officer-marker-role";
  roleLabel.style.color = "#FCDD07";
  roleLabel.style.fontSize = "9px";
  roleLabel.textContent = role.replace(/_/g, " ");

  el.appendChild(nameLabel);
  el.appendChild(roleLabel);
  return el;
}

function vehicleMarkerElement(reg: string) {
  const el = document.createElement("div");
  el.style.background = "#0F47AF";
  el.style.border = "1.5px solid #FCDD07";
  el.style.borderRadius = "6px";
  el.style.padding = "2px 5px";
  el.style.fontSize = "9px";
  el.style.fontWeight = "700";
  el.style.color = "white";
  el.style.whiteSpace = "nowrap";
  el.style.opacity = "0.75";
  el.textContent = `\u{1F690} ${reg}`;
  return el;
}

interface EnforcementMapProps {
  beats: Beat[];
  zones: Zone[];
  token: string;
}

export default function EnforcementMap({ beats, zones, token }: EnforcementMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TomTomMapType | null>(null);
  const officerMarkersRef = useRef<Record<string, MaplibreMarker>>({});
  const vehicleMarkersRef = useRef<Record<string, MaplibreMarker>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const zoneOrder = zones.map((z) => z.id);

  // Initialize the TomTom map once
  useEffect(() => {
    if (!TOMTOM_API_KEY) return;
    let destroyed = false;

    (async () => {
      const [{ TomTomConfig }, { TomTomMap }] = await Promise.all([
        import("@tomtom-org/maps-sdk/core"),
        import("@tomtom-org/maps-sdk/map"),
      ]);
      if (destroyed || !containerRef.current || mapRef.current) return;

      TomTomConfig.instance.put({ apiKey: TOMTOM_API_KEY });

      const map = new TomTomMap({
        style: "standardDark",
        mapLibre: {
          container: containerRef.current,
          center: NAIROBI_CBD_CENTER,
          zoom: 11.5,
        },
      });
      mapRef.current = map;

      const setupLayers = () => {
        if (destroyed) return;
        const glMap = map.mapLibreMap;
        if (glMap.getSource("beat-lines")) return;

        const drawableBeats = beats.filter(
          (b) => b.fromLat != null && b.fromLng != null && b.toLat != null && b.toLng != null
        );

        glMap.addSource("beat-lines", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: drawableBeats.map((b) => ({
              type: "Feature",
              properties: { color: zoneColor(b.zoneId, zoneOrder) },
              geometry: {
                type: "LineString",
                coordinates: [
                  [b.fromLng as number, b.fromLat as number],
                  [b.toLng as number, b.toLat as number],
                ],
              },
            })),
          },
        });
        glMap.addLayer({
          id: "beat-lines-layer",
          type: "line",
          source: "beat-lines",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 4,
            "line-opacity": 0.75,
          },
        });
      };

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
  }, [beats, zones]);

  // Real-time officer + vehicle telemetry over one WebSocket, with reconnect/backoff.
  useEffect(() => {
    if (!TOMTOM_API_KEY || !token) return;
    let cancelled = false;

    const connect = async () => {
      if (cancelled) return;
      const maplibregl = await import("maplibre-gl");
      setConnectionStatus("connecting");

      const ws = new WebSocket(`${WS_BASE_URL}/api/telemetry/ws/staff?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionStatus("live");
      };

      const upsertOfficer = (o: LiveOfficerTelemetry) => {
        const map = mapRef.current;
        if (!map) return;
        const glMap = map.mapLibreMap;
        const existing = officerMarkersRef.current[o.officer_id];
        if (existing) {
          existing.setLngLat([o.lng, o.lat]);
        } else {
          const marker = new maplibregl.Marker({ element: officerMarkerElement(o.officer_name, o.role) })
            .setLngLat([o.lng, o.lat])
            .addTo(glMap);
          officerMarkersRef.current[o.officer_id] = marker;
        }
      };

      const upsertVehicle = (v: LiveVehicleTelemetry) => {
        const map = mapRef.current;
        if (!map) return;
        const glMap = map.mapLibreMap;
        const existing = vehicleMarkersRef.current[v.matatu_id];
        if (existing) {
          existing.setLngLat([v.lng, v.lat]);
        } else {
          const marker = new maplibregl.Marker({ element: vehicleMarkerElement(v.reg_number) })
            .setLngLat([v.lng, v.lat])
            .addTo(glMap);
          vehicleMarkersRef.current[v.matatu_id] = marker;
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "INIT_TELEMETRY") {
            (payload.officers || []).forEach(upsertOfficer);
            (payload.vehicles || []).forEach(upsertVehicle);
          } else if (payload.type === "OFFICER_POSITION_UPDATE" && payload.officer) {
            upsertOfficer(payload.officer);
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
  }, [token]);

  const dotColor =
    connectionStatus === "live" ? "#068930" : connectionStatus === "connecting" ? "#F5C518" : "#B4232C";

  return (
    <div className="rounded-2xl overflow-hidden relative border border-white/10 shadow-2xl">
      {!TOMTOM_API_KEY ? (
        <div className="h-[420px] flex items-center justify-center bg-county-black text-white/50 text-xs font-semibold px-6 text-center">
          Set NEXT_PUBLIC_TOMTOM_API_KEY to enable the enforcement live map.
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-[420px]" />
      )}
      {TOMTOM_API_KEY && (
        <>
          <span className="absolute top-3 right-3 flex h-2.5 w-2.5 z-10">
            {connectionStatus !== "offline" && (
              <span
                className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: dotColor }}
              />
            )}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
          </span>
          {zones.length > 0 && (
            <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 max-w-[70%]">
              {zones.map((z) => (
                <span
                  key={z.id}
                  className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] font-bold text-white"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: zoneColor(z.id, zoneOrder) }}
                  />
                  {z.name}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
