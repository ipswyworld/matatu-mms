"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Trash2, X } from "lucide-react";

const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
const NAIROBI_CENTER: [number, number] = [36.8228, -1.2864]; // [lng, lat]

export interface BoundaryResult {
  /** JSON-stringified GeoJSON Polygon geometry, ready for the backend's
   *  plain-string boundary_geojson column (duty.py's ZoneUpsert/SectorUpsert). */
  boundaryGeojson: string;
  centerLat: number;
  centerLng: number;
}

/**
 * Draw or edit a single polygon boundary on a real map — the shared editor
 * behind both zone creation (app/(app)/zones) and sector-boundary editing,
 * since duty.py's Zone and Sector rows share the identical
 * boundary_geojson/center_lat/center_lng field shape.
 *
 * Uses the same TomTom-styled MapLibre stack as GisMap.tsx (no new base map
 * dependency), with terra-draw's polygon mode layered on top of the
 * underlying maplibre-gl instance for the actual drawing interaction —
 * terra-draw is the maintained draw plugin for MapLibre v5 (mapbox-gl-draw
 * is not compatible with this MapLibre major version).
 */
export default function PolygonBoundaryEditor({
  existingGeojson,
  onSave,
  onCancel,
}: {
  /** Existing boundary_geojson string, if editing rather than creating. */
  existingGeojson?: string | null;
  onSave: (result: BoundaryResult) => void;
  onCancel?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const drawRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [hasPolygon, setHasPolygon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!TOMTOM_API_KEY) {
      setError("Set NEXT_PUBLIC_TOMTOM_API_KEY to enable the map editor.");
      return;
    }
    let destroyed = false;

    (async () => {
      const [{ TomTomConfig }, { TomTomMap }, maplibregl, terraDraw, terraDrawAdapter] = await Promise.all([
        import("@tomtom-org/maps-sdk/core"),
        import("@tomtom-org/maps-sdk/map"),
        import("maplibre-gl"),
        import("terra-draw"),
        import("terra-draw-maplibre-gl-adapter"),
      ]);
      if (destroyed || !containerRef.current || mapRef.current) return;

      TomTomConfig.instance.put({ apiKey: TOMTOM_API_KEY });
      const map = new TomTomMap({
        style: "standardLight",
        mapLibre: { container: containerRef.current, center: NAIROBI_CENTER, zoom: 11 },
      });
      mapRef.current = map;

      const setupDraw = () => {
        if (destroyed) return;
        const glMap = map.mapLibreMap;

        const draw = new terraDraw.TerraDraw({
          adapter: new terraDrawAdapter.TerraDrawMapLibreGLAdapter({ map: glMap }),
          modes: [new terraDraw.TerraDrawPolygonMode(), new terraDraw.TerraDrawSelectMode()],
        });
        drawRef.current = draw;
        draw.start();

        if (existingGeojson) {
          try {
            const geometry = JSON.parse(existingGeojson);
            draw.addFeatures([{ type: "Feature", properties: {}, geometry }]);
            setHasPolygon(true);
            draw.setMode("select");
          } catch {
            draw.setMode("polygon");
          }
        } else {
          draw.setMode("polygon");
        }

        draw.on("finish", () => {
          setHasPolygon(true);
          draw.setMode("select");
        });

        setReady(true);
      };

      const readyCheck = setInterval(() => {
        if (destroyed) {
          clearInterval(readyCheck);
          return;
        }
        if (map.mapReady) {
          clearInterval(readyCheck);
          setupDraw();
        }
      }, 100);
    })();

    return () => {
      destroyed = true;
      drawRef.current?.stop();
      mapRef.current?.mapLibreMap.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function centroidOf(coordinates: number[][][]): { lat: number; lng: number } {
    // Simple average of the exterior ring's vertices — a label anchor, not
    // a true geometric centroid (duty.py stores center_lat/lng as display
    // anchors only, never used for point-in-polygon or area math, so this
    // is precise enough and needs no turf.js dependency).
    const ring = coordinates[0] || [];
    if (ring.length === 0) return { lat: NAIROBI_CENTER[1], lng: NAIROBI_CENTER[0] };
    const sum = ring.reduce((acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }), { lng: 0, lat: 0 });
    return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
  }

  function handleSave() {
    const draw = drawRef.current;
    if (!draw) return;
    const snapshot = draw.getSnapshot();
    const polygon = snapshot.find((f: any) => f.geometry?.type === "Polygon");
    if (!polygon) {
      setError("Draw a boundary first — click to place points, then close the shape.");
      return;
    }
    const { lat, lng } = centroidOf(polygon.geometry.coordinates);
    onSave({ boundaryGeojson: JSON.stringify(polygon.geometry), centerLat: lat, centerLng: lng });
  }

  function handleClear() {
    drawRef.current?.clear();
    setHasPolygon(false);
    drawRef.current?.setMode("polygon");
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-black/50">
        Click to place points around the boundary, then click the first point again to close the shape. Drag a point
        to adjust it afterward.
      </p>
      {error && <p className="text-xs text-county-red font-semibold">{error}</p>}
      {TOMTOM_API_KEY ? (
        <div ref={containerRef} className="w-full h-[360px] rounded-xl overflow-hidden border border-black/10" />
      ) : (
        <div className="w-full h-[360px] rounded-xl border border-black/10 bg-black/[0.02] flex items-center justify-center text-xs text-black/40">
          Map unavailable — TomTom API key not configured.
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleClear}
          disabled={!ready}
          className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 disabled:opacity-40 flex items-center gap-1"
        >
          <Trash2 size={12} strokeWidth={2} />
          Clear
        </button>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="text-xs font-bold px-2.5 py-1.5 rounded-lg hover:bg-black/5 flex items-center gap-1">
              <X size={12} strokeWidth={2} />
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!ready || !hasPolygon}
            className="btn-primary !py-1.5 !px-3 text-xs font-bold flex items-center gap-1 disabled:opacity-40"
          >
            <Check size={12} strokeWidth={2.5} />
            Use this boundary
          </button>
        </div>
      </div>
    </div>
  );
}
