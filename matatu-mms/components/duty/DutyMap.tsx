"use client";

import { useEffect, useRef } from "react";
import type { Marker } from "maplibre-gl";
import { Sector, Zone } from "@/lib/types";

const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY || "";
const NAIROBI_CBD_CENTER: [number, number] = [36.8228, -1.2864]; // lng, lat

// Same palette EnforcementMap.tsx uses for beats, so a sector keeps one
// colour across both maps rather than meaning something different on each.
const SECTOR_COLORS = ["#068930", "#0F47AF", "#F5C518", "#B4232C", "#7C3AED", "#0891B2"];

interface DutyMapProps {
  sectors: Sector[];
  zones: Zone[];
  onSelectZone?: (zoneId: string) => void;
}

function markerElement(label: string, color: string, isSector: boolean): HTMLElement {
  const el = document.createElement("div");
  const size = isSector ? 30 : 22;
  el.style.cssText = [
    "display:flex", "align-items:center", "justify-content:center",
    `width:${size}px`, `height:${size}px`,
    `border-radius:${isSector ? "8px" : "50%"}`,
    `background:${color}`, "color:#fff",
    `font-size:${isSector ? 11 : 9}px`, "font-weight:800",
    "border:2px solid #fff", "box-shadow:0 1px 4px rgba(0,0,0,.35)",
    "cursor:pointer", "font-family:system-ui,sans-serif",
  ].join(";");
  // textContent, never innerHTML — sector/zone names are operator-entered
  // and would otherwise be an injection path onto the map, the same
  // reasoning GisMap.tsx documents for its vehicle markers.
  el.textContent = label;
  return el;
}

/**
 * Sectors and zones on a map. Points, not polygons: the seeded centre
 * coordinates are approximate, and no real boundary data exists yet (see
 * seed_ptcu_sectors_and_zones' own note on why boundaries were left null
 * rather than guessed). A drawn boundary that was invented would look
 * exactly like a surveyed one, which is the wrong impression to give
 * about an enforcement boundary.
 *
 * The fill layer below is already wired for real boundary GeoJSON, so
 * loading the county's GIS data later needs no change here.
 */
export default function DutyMap({ sectors, zones, onSelectZone }: DutyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!TOMTOM_API_KEY) return;
    let destroyed = false;
    let markers: Marker[] = [];

    (async () => {
      const [{ TomTomConfig }, { TomTomMap }, maplibre] = await Promise.all([
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
          zoom: 13,
        },
      });
      mapRef.current = map;

      const setup = () => {
        if (destroyed) return;
        const glMap = map.mapLibreMap;
        if (glMap.getSource("sector-areas")) return;

        const withBoundary = sectors.filter((s) => s.boundaryGeojson);
        if (withBoundary.length) {
          glMap.addSource("sector-areas", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: withBoundary.map((s, i) => ({
                type: "Feature" as const,
                properties: { color: SECTOR_COLORS[i % SECTOR_COLORS.length] },
                geometry: JSON.parse(s.boundaryGeojson as string),
              })),
            },
          });
          glMap.addLayer({
            id: "sector-areas-fill",
            type: "fill",
            source: "sector-areas",
            paint: { "fill-color": ["get", "color"], "fill-opacity": 0.15 },
          });
          glMap.addLayer({
            id: "sector-areas-outline",
            type: "line",
            source: "sector-areas",
            paint: { "line-color": ["get", "color"], "line-width": 2 },
          });
        }

        sectors.forEach((sector, i) => {
          if (sector.centerLat == null || sector.centerLng == null) return;
          const el = markerElement(sector.code, SECTOR_COLORS[i % SECTOR_COLORS.length], true);
          el.title = `Sector ${sector.code} — ${sector.name}`;
          markers.push(
            new maplibre.Marker({ element: el })
              .setLngLat([sector.centerLng, sector.centerLat])
              .addTo(glMap)
          );
        });

        const sectorIndex = new Map(sectors.map((s, i) => [s.id, i]));
        zones.forEach((zone) => {
          if (zone.centerLat == null || zone.centerLng == null || !zone.sectorId) return;
          const i = sectorIndex.get(zone.sectorId) ?? 0;
          const el = markerElement(zone.code || "•", SECTOR_COLORS[i % SECTOR_COLORS.length], false);
          el.title = zone.name;
          if (onSelectZone) el.addEventListener("click", () => onSelectZone(zone.id));
          markers.push(
            new maplibre.Marker({ element: el })
              .setLngLat([zone.centerLng, zone.centerLat])
              .addTo(glMap)
          );
        });
      };

      // Same readiness poll EnforcementMap.tsx uses — TomTomMap exposes
      // `mapReady` rather than a load event of its own.
      const readyCheck = setInterval(() => {
        if (destroyed) {
          clearInterval(readyCheck);
          return;
        }
        if (map.mapReady) {
          clearInterval(readyCheck);
          setup();
        }
      }, 100);
    })();

    return () => {
      destroyed = true;
      markers.forEach((m) => m.remove());
      mapRef.current?.mapLibreMap.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectors, zones]);

  return (
    <div className="card p-5">
      <div className="mb-3">
        <h3 className="font-bold text-sm text-county-black">Sector &amp; zone map</h3>
        <p className="text-[11px] text-black/50 mt-0.5">
          Squares are sectors, circles are zones. Positions are approximate until the county&apos;s own
          boundary data is loaded.
        </p>
      </div>
      {TOMTOM_API_KEY ? (
        <div ref={containerRef} className="h-[320px] rounded-xl overflow-hidden bg-black/[0.03]" />
      ) : (
        <div className="h-[320px] rounded-xl bg-black/[0.03] flex items-center justify-center text-xs text-black/40">
          Map key not configured.
        </div>
      )}
    </div>
  );
}
