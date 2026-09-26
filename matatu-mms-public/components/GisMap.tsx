"use client";

import { useEffect, useRef, useState } from "react";
import type { TomTomMap as TomTomMapType } from "@tomtom-org/maps-sdk/map";
import type { GeoJSONSource, Marker as MaplibreMarker } from "maplibre-gl";

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

interface TripPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface GisMapProps {
  /** The passenger's chosen boarding point. Drawn as a pin only when set —
   * a passenger-facing map has no reason to show every stage in the
   * system, the same way Uber/Bolt's map stays empty until you've told it
   * where you're going. */
  fromStage?: TripPoint | null;
  /** The passenger's chosen destination. When both fromStage and toStage
   * are set, a route line is drawn between them. */
  toStage?: TripPoint | null;
  /** One-transfer journeys (Phase 9, #6) — when set alongside fromStage and
   * toStage, the route line draws as two segments (from→via, via→to)
   * through this transfer stage instead of one straight from→to line, and
   * a third pin marks the transfer point. */
  viaStage?: TripPoint | null;
  /** Once the passenger has picked a specific matatu, narrow the live map
   * to that one vehicle — every other vehicle currently broadcasting
   * telemetry is hidden, the same "everyone else disappears once you're
   * matched" behavior Uber/Bolt use. Today's data source is this app's own
   * telemetry WebSocket; when that feed is backed by NTSA's IRMS instead,
   * this filtering logic doesn't change — it only cares about matatu_id. */
  focusedVehicleId?: string | null;
  /** Once the passenger has actually boarded (not just selected) a matatu,
   * the route line should follow where the vehicle really is right now,
   * not the static two-point line from the original search selection —
   * a straight line from an old position reads as wrong the moment the
   * vehicle moves. When set, the line's starting point is driven by this
   * vehicle's live telemetry on every update instead of `fromStage`, and
   * the static "from" pin (which represented "where I'm boarding", now
   * moot) is hidden in favor of the vehicle marker itself. */
  boardedMatatuId?: string | null;
  /** When true, skip this component's own outer rounded/border/shadow
   * wrapper — used when a parent composes the map with another surface
   * (e.g. PassengerBookingClient's map+search instrument) and needs to own
   * the outer container itself to avoid a double border/shadow. Default
   * false preserves the standalone look every other caller relies on. */
  embedded?: boolean;
}

function tripPinElement(kind: "from" | "to" | "via") {
  const el = document.createElement("div");
  el.style.width = kind === "via" ? "14px" : "18px";
  el.style.height = kind === "via" ? "14px" : "18px";
  el.style.borderRadius = kind === "from" ? "50%" : kind === "via" ? "50%" : "50% 50% 50% 0";
  el.style.transform = kind === "to" ? "rotate(-45deg)" : "none";
  el.style.background = kind === "from" ? "#068930" : kind === "via" ? "#FCDD07" : "#B4232C";
  el.style.border = "2.5px solid #ffffff";
  el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.45)";
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

export default function GisMap({ fromStage, toStage, viaStage, focusedVehicleId, boardedMatatuId, embedded = false }: GisMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TomTomMapType | null>(null);
  const mapReadyRef = useRef(false);
  const vehicleMarkersRef = useRef<Record<string, MaplibreMarker>>({});
  // Latest known telemetry per vehicle, independent of which markers are
  // currently rendered — lets syncVisibleVehicles() rebuild the visible set
  // instantly when focusedVehicleId changes, without waiting on the next
  // WebSocket frame.
  const vehicleDataRef = useRef<Record<string, LiveVehicleTelemetry>>({});
  const focusedVehicleIdRef = useRef<string | null | undefined>(focusedVehicleId);
  const boardedMatatuIdRef = useRef<string | null | undefined>(boardedMatatuId);
  const toStageRef = useRef<TripPoint | null | undefined>(toStage);
  useEffect(() => {
    boardedMatatuIdRef.current = boardedMatatuId;
  }, [boardedMatatuId]);
  useEffect(() => {
    toStageRef.current = toStage;
  }, [toStage]);
  const fromMarkerRef = useRef<MaplibreMarker | null>(null);
  const toMarkerRef = useRef<MaplibreMarker | null>(null);
  const viaMarkerRef = useRef<MaplibreMarker | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "live" | "offline">("connecting");

  // Initialize the TomTom map once. Deliberately empty on load: this is a
  // passenger-facing map, not an ops tool, so it shows nothing until the
  // passenger has actually planned a trip — same read as Uber/Bolt/Google
  // Maps' own "where to?" pattern, where the map stays clean and the route
  // only appears once there's a real origin/destination to draw.
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
          zoom: 12,
        },
      });
      mapRef.current = map;

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
          const glMap = map.mapLibreMap;
          glMap.addSource("trip-route", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          glMap.addLayer({
            id: "trip-route-layer",
            type: "line",
            source: "trip-route",
            paint: { "line-color": "#FCDD07", "line-width": 3, "line-opacity": 0.85 },
          });
          mapReadyRef.current = true;
        }
      }, 100);
    })();

    return () => {
      destroyed = true;
      mapRef.current?.mapLibreMap.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

  // Draw/update the From and To pins plus the route line between them
  // whenever the passenger's trip selection changes.
  useEffect(() => {
    if (!TOMTOM_API_KEY) return;
    let cancelled = false;

    const render = async () => {
      const map = mapRef.current;
      if (cancelled || !map || !mapReadyRef.current) return;
      const maplibregl = await import("maplibre-gl");
      const glMap = map.mapLibreMap;

      fromMarkerRef.current?.remove();
      fromMarkerRef.current = null;
      toMarkerRef.current?.remove();
      toMarkerRef.current = null;
      viaMarkerRef.current?.remove();
      viaMarkerRef.current = null;

      // Once boarded, the vehicle marker itself stands in for "from" — a
      // static pin at the old boarding point would just be visual clutter
      // next to the moving vehicle.
      if (fromStage && !boardedMatatuId) {
        fromMarkerRef.current = new maplibregl.Marker({ element: tripPinElement("from") })
          .setLngLat([fromStage.lng, fromStage.lat])
          .addTo(glMap);
      }
      if (toStage) {
        toMarkerRef.current = new maplibregl.Marker({ element: tripPinElement("to") })
          .setLngLat([toStage.lng, toStage.lat])
          .addTo(glMap);
      }
      if (viaStage) {
        viaMarkerRef.current = new maplibregl.Marker({ element: tripPinElement("via") })
          .setLngLat([viaStage.lng, viaStage.lat])
          .addTo(glMap);
      }

      // While boarded, the line is driven by live telemetry instead (see
      // upsertVehicle below) — skip the static draw so it doesn't
      // momentarily flash the stale from→to line on every re-render.
      if (!boardedMatatuId) {
        const source = glMap.getSource("trip-route") as GeoJSONSource | undefined;
        if (source) {
          const lineSegments: [number, number][][] =
            fromStage && toStage && viaStage
              ? [
                  [[fromStage.lng, fromStage.lat], [viaStage.lng, viaStage.lat]],
                  [[viaStage.lng, viaStage.lat], [toStage.lng, toStage.lat]],
                ]
              : fromStage && toStage
              ? [[[fromStage.lng, fromStage.lat], [toStage.lng, toStage.lat]]]
              : [];
          source.setData({
            type: "FeatureCollection",
            features: lineSegments.map((coordinates) => ({
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            })),
          });
        }
      }

      if (fromStage || toStage || viaStage) {
        const points: [number, number][] = [];
        if (fromStage) points.push([fromStage.lng, fromStage.lat]);
        if (viaStage) points.push([viaStage.lng, viaStage.lat]);
        if (toStage) points.push([toStage.lng, toStage.lat]);
        const bounds = new maplibregl.LngLatBounds(points[0], points[0]);
        points.forEach((p) => bounds.extend(p));
        glMap.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 500 });
      }
    };

    // mapReadyRef may not be set yet on first render if the map is still
    // loading — poll briefly rather than dropping the initial selection.
    const retry = setInterval(() => {
      if (cancelled) {
        clearInterval(retry);
        return;
      }
      if (mapReadyRef.current) {
        clearInterval(retry);
        render();
      }
    }, 150);

    return () => {
      cancelled = true;
      clearInterval(retry);
    };
  }, [fromStage, toStage, viaStage, boardedMatatuId]);

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

      // Only renders a vehicle if it isn't filtered out by focusedVehicleId —
      // when a passenger has picked a specific matatu, every other vehicle
      // is removed from the map rather than left cluttering it.
      const upsertVehicle = (v: LiveVehicleTelemetry) => {
        vehicleDataRef.current[v.matatu_id] = v;
        const map = mapRef.current;
        if (!map) return;
        const glMap = map.mapLibreMap;

        const focus = focusedVehicleIdRef.current;
        if (focus && v.matatu_id !== focus) {
          vehicleMarkersRef.current[v.matatu_id]?.remove();
          delete vehicleMarkersRef.current[v.matatu_id];
          return;
        }

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

        // Boarded: the line follows this vehicle's real position on every
        // tick instead of the static from→to line drawn at search time —
        // it's an accurate "where I actually am right now" line, not a
        // stale snapshot of where I planned to board.
        if (boardedMatatuIdRef.current && v.matatu_id === boardedMatatuIdRef.current) {
          const to = toStageRef.current;
          const source = glMap.getSource("trip-route") as GeoJSONSource | undefined;
          if (source) {
            source.setData({
              type: "FeatureCollection",
              features: to
                ? [
                    {
                      type: "Feature",
                      properties: {},
                      geometry: { type: "LineString", coordinates: [[v.lng, v.lat], [to.lng, to.lat]] },
                    },
                  ]
                : [],
            });
          }
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

  // Rebuild the visible vehicle markers immediately when the passenger
  // picks (or clears) a focused vehicle, using already-known telemetry —
  // otherwise the map wouldn't react until the next WebSocket frame.
  useEffect(() => {
    focusedVehicleIdRef.current = focusedVehicleId;
    const map = mapRef.current;
    if (!map) return;
    const glMap = map.mapLibreMap;

    Object.entries(vehicleDataRef.current).forEach(([matatuId, v]) => {
      const shouldShow = !focusedVehicleId || matatuId === focusedVehicleId;
      const existing = vehicleMarkersRef.current[matatuId];
      if (!shouldShow) {
        existing?.remove();
        delete vehicleMarkersRef.current[matatuId];
      } else if (!existing) {
        import("maplibre-gl").then((maplibregl) => {
          const marker = new maplibregl.Marker({ element: matatuMarkerElement(v.reg_number, v.speed) })
            .setLngLat([v.lng, v.lat])
            .addTo(glMap);
          const popup = new maplibregl.Popup({ closeButton: false, offset: 12 }).setText(
            `Route ${v.route_code} · ${v.speed} km/h`
          );
          const el = marker.getElement();
          el.addEventListener("mouseenter", () => popup.setLngLat([v.lng, v.lat]).addTo(glMap));
          el.addEventListener("mouseleave", () => popup.remove());
          vehicleMarkersRef.current[matatuId] = marker;
        });
      }
    });
  }, [focusedVehicleId]);

  const dotColor =
    connectionStatus === "live" ? "#068930" : connectionStatus === "connecting" ? "#F5C518" : "#B4232C";

  return (
    <div className={embedded ? "relative" : "rounded-2xl overflow-hidden relative border border-white/10 shadow-2xl"}>
      {!TOMTOM_API_KEY ? (
        <div className="h-[380px] flex items-center justify-center bg-county-black text-white/50 text-xs font-semibold px-6 text-center">
          Set NEXT_PUBLIC_TOMTOM_API_KEY to enable the live map.
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-[380px] md:h-[460px] lg:h-[540px]" />
      )}
      {/* First-run guidance (critique P1) — an empty dark map with no other
          cue reads as broken, not "clean", to a first-time passenger.
          Pointer-events-none so it never blocks the map underneath once
          markers/interactions exist there. */}
      {TOMTOM_API_KEY && !fromStage && !toStage && !boardedMatatuId && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-8">
          <p className="text-white/60 text-sm font-semibold text-center max-w-xs">
            Search where you're headed to see matatus near you
          </p>
        </div>
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
