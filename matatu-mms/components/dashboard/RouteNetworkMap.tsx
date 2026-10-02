"use client";

import { useEffect, useRef, useState } from "react";
import type { TomTomMap as TomTomMapType } from "@tomtom-org/maps-sdk/map";
import Link from "next/link";
import { Fine, Matatu, Route, RouteGeometry } from "@/lib/types";

const NAIROBI_CBD_CENTER: [number, number] = [36.8228, -1.2864];
const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

interface RouteNetworkMapProps {
  geometry: RouteGeometry[];
  routes: Route[];
  matatus: Matatu[];
  fines: Fine[];
}

interface SelectedRouteStats {
  route: Route | undefined;
  code: string;
  name: string;
  count: number;
  active: number;
  flagged: number;
  pendingValue: number;
  compliancePct: number;
}

function computeStats(routeId: string, code: string, name: string, routes: Route[], matatus: Matatu[], fines: Fine[]): SelectedRouteStats {
  const route = routes.find((r) => r.id === routeId);
  const routeMatatus = matatus.filter((m) => m.routeId === routeId);
  const active = routeMatatus.filter((m) => m.status === "ACTIVE").length;
  const flagged = routeMatatus.filter((m) => m.status === "FLAGGED" || m.status === "IMPOUNDED").length;
  const routeMatatuIds = new Set(routeMatatus.map((m) => m.id));
  const pendingValue = fines
    .filter((f) => f.status === "PENDING" && routeMatatuIds.has(f.matatuId))
    .reduce((sum, f) => sum + f.amountKes, 0);
  const compliancePct = routeMatatus.length > 0 ? Math.round((active / routeMatatus.length) * 100) : 0;
  return { route, code, name, count: routeMatatus.length, active, flagged, pendingValue, compliancePct };
}

/**
 * The Nairobi bus route network on a real TomTom map — every route drawn as
 * a colored line from its geocoded stage sequence (GET /api/routes/network),
 * replacing the old flat "Route corridor health" card list. Tapping a line
 * shows that one route's compliance/fine stats in a small corner panel
 * instead of rendering all 125 routes' detail cards at once.
 */
export default function RouteNetworkMap({ geometry, routes, matatus, fines }: RouteNetworkMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TomTomMapType | null>(null);
  const [selected, setSelected] = useState<SelectedRouteStats | null>(null);

  useEffect(() => {
    if (!TOMTOM_API_KEY || geometry.length === 0) return;
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
        mapLibre: { container: containerRef.current, center: NAIROBI_CBD_CENTER, zoom: 11 },
      });
      mapRef.current = map;

      const setupLayers = () => {
        if (destroyed) return;
        const glMap = map.mapLibreMap;
        if (glMap.getSource("route-network")) return;

        const features = geometry.map((g) => ({
          type: "Feature" as const,
          properties: { routeId: g.id, code: g.code, name: g.name, color: g.color },
          geometry: {
            type: "LineString" as const,
            coordinates: g.points.map((p) => [p.lng, p.lat]),
          },
        }));

        glMap.addSource("route-network", { type: "geojson", data: { type: "FeatureCollection", features } });

        glMap.addLayer({
          id: "route-network-base",
          type: "line",
          source: "route-network",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.65 },
        });

        // A second layer filtered to just the selected route, drawn on top
        // wider/brighter — simpler and cheaper than restyling every feature
        // in the base layer on every click.
        glMap.addLayer({
          id: "route-network-highlight",
          type: "line",
          source: "route-network",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 1 },
          filter: ["==", ["get", "routeId"], "__none__"],
        });

        // Fit the whole network on first load rather than a hardcoded
        // viewport, so it stays correct as more routes get real geometry.
        const bounds = new maplibregl.LngLatBounds();
        features.forEach((f) => f.geometry.coordinates.forEach((c) => bounds.extend(c as [number, number])));
        if (!bounds.isEmpty()) {
          glMap.fitBounds(bounds, { padding: 32, duration: 0 });
        }

        glMap.on("mouseenter", "route-network-base", () => {
          glMap.getCanvas().style.cursor = "pointer";
        });
        glMap.on("mouseleave", "route-network-base", () => {
          glMap.getCanvas().style.cursor = "";
        });

        glMap.on("click", "route-network-base", (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const { routeId, code, name } = feature.properties as { routeId: string; code: string; name: string };
          glMap.setFilter("route-network-highlight", ["==", ["get", "routeId"], routeId]);
          setSelected(computeStats(routeId, code, name, routes, matatus, fines));
        });

        // Clicking empty map area (not a route line) clears the selection.
        glMap.on("click", (e) => {
          const hits = glMap.queryRenderedFeatures(e.point, { layers: ["route-network-base"] });
          if (hits.length === 0) {
            glMap.setFilter("route-network-highlight", ["==", ["get", "routeId"], "__none__"]);
            setSelected(null);
          }
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
  }, [geometry]);

  const unmappedCount = routes.length - geometry.length;

  return (
    <div className="rounded-2xl bg-white p-5 md:p-6 shadow-sm ring-1 ring-county-ink/[0.06]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">Route network</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">
            Tap a route to see its compliance and outstanding fines
            {unmappedCount > 0 && ` · ${unmappedCount} route${unmappedCount !== 1 ? "s" : ""} not yet mapped`}
          </p>
        </div>
        <Link href="/routes" className="text-xs font-bold text-county-green hover:underline shrink-0">
          Manage routes →
        </Link>
      </div>

      <div className="rounded-xl overflow-hidden relative border border-county-ink/10">
        {!TOMTOM_API_KEY ? (
          <div className="h-[420px] flex items-center justify-center bg-county-black text-white/50 text-xs font-semibold px-6 text-center">
            Set NEXT_PUBLIC_TOMTOM_API_KEY to enable the route network map.
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-[420px]" />
        )}

        {selected && (
          <div className="absolute top-3 left-3 right-3 sm:right-auto sm:w-72 rounded-xl bg-white/95 backdrop-blur p-4 shadow-lg ring-1 ring-county-ink/10">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="badge bg-county-green/10 text-county-green">Route {selected.code}</span>
                <h4 className="font-black text-county-ink text-sm mt-1.5 truncate">{selected.name}</h4>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-county-ink/40 hover:text-county-ink text-xs font-bold shrink-0"
                aria-label="Close route details"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 pt-3 border-t border-county-ink/[0.06] flex items-center justify-between">
              <div>
                <div
                  className={`text-2xl font-black tabular-nums leading-none ${
                    selected.flagged === 0 ? "text-county-green" : "text-county-yellow-dark"
                  }`}
                >
                  {selected.compliancePct}%
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-county-ink/45 mt-1">Compliant</div>
              </div>
              <div className="text-right text-[12px]">
                <div className="text-county-ink/55">
                  <span className="font-bold text-county-ink">{selected.active}</span> active ·{" "}
                  <span className={selected.flagged > 0 ? "font-bold text-county-yellow-dark" : "text-county-ink/40"}>
                    {selected.flagged}
                  </span>{" "}
                  flagged
                </div>
                {selected.pendingValue > 0 ? (
                  <div className="font-bold text-county-red mt-0.5">KES {(selected.pendingValue / 1000).toFixed(0)}k pending</div>
                ) : (
                  <div className="text-county-ink/40 mt-0.5">No outstanding fines</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
