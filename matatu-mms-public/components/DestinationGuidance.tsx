"use client";

import { useEffect, useRef, useState } from "react";
import { Navigation2, MapPin, Footprints, CheckCircle2, X } from "lucide-react";
import { NAIROBI_STAGES } from "@/components/GisMap";
import {
  usePassengerLocation,
  haversineMeters,
  bearingDegrees,
  cardinalDirection,
  formatDistance,
  formatWalkingEta,
} from "@/lib/geo";

const STORAGE_KEY = "matatu-mms:destination-guidance";
const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

interface StoredDestination {
  stageId: string;
  name: string;
  lat: number;
  lng: number;
  alighted: boolean;
}

function loadStored(): StoredDestination | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStored(value: StoredDestination | null) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  else window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * "Guide Me" — the investor-requested feature: a passenger sets where
 * they're really headed once, and the app keeps guiding them on foot even
 * after they've alighted from the matatu early (e.g. off at Odeon, walking
 * the rest of the way to Church House). Deliberately decoupled from
 * booking — the scenario doesn't require booking through this system, just
 * being a passenger on a matatu, so this works for anyone.
 *
 * State lives in localStorage only. There's no way to detect "got off a
 * vehicle" automatically without a beacon on the bus, so "I've Alighted
 * Here" is the one manual step; everything else (distance, walking ETA,
 * which way to walk, the map itself) stays inside this app — TomTom (the
 * same map SDK GisMap.tsx already uses, no new API key) renders the
 * passenger's live position and the destination with a line between them,
 * rather than handing off to an external maps app.
 */
export default function DestinationGuidance() {
  const [destination, setDestination] = useState<StoredDestination | null>(null);
  const [pickerStageId, setPickerStageId] = useState(NAIROBI_STAGES[0].id);
  const [hydrated, setHydrated] = useState(false);
  const { location, status, request } = usePassengerLocation();

  useEffect(() => {
    const stored = loadStored();
    setDestination(stored);
    setHydrated(true);
    // Re-request location on page load if guidance was already active before
    // a refresh — otherwise the alighted view is stuck on "Getting your
    // location…" forever, since markAlighted() only fires the request once,
    // at the moment the button is tapped.
    if (stored?.alighted) request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGuidance = () => {
    const stage = NAIROBI_STAGES.find((s) => s.id === pickerStageId);
    if (!stage) return;
    const next: StoredDestination = { stageId: stage.id, name: stage.name, lat: stage.lat, lng: stage.lng, alighted: false };
    setDestination(next);
    saveStored(next);
  };

  const markAlighted = () => {
    if (!destination) return;
    request();
    const next = { ...destination, alighted: true };
    setDestination(next);
    saveStored(next);
  };

  const clearGuidance = () => {
    setDestination(null);
    saveStored(null);
  };

  if (!hydrated) return null;

  if (!destination) {
    return (
      <div className="card p-4 space-y-3">
        <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
          <Footprints size={15} strokeWidth={2} className="text-county-ink/50" />
          Going somewhere specific?
        </h3>
        <p className="text-xs text-black/50 -mt-1">
          Tell us your real destination once — we'll keep guiding you on foot even after you get off the matatu.
        </p>
        <div className="flex gap-2">
          <select value={pickerStageId} onChange={(e) => setPickerStageId(e.target.value)} className="input flex-1 text-xs">
            {NAIROBI_STAGES.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button onClick={startGuidance} className="btn-primary !px-4 text-xs font-bold shrink-0 flex items-center gap-1.5">
            <Navigation2 size={13} strokeWidth={2} />
            Guide Me There
          </button>
        </div>
      </div>
    );
  }

  if (!destination.alighted) {
    return (
      <div className="card p-4 space-y-3 border-l-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <MapPin size={15} strokeWidth={2} className="text-county-green shrink-0" />
            <span className="text-sm font-bold text-county-black">Heading to {destination.name}</span>
          </div>
          <button onClick={clearGuidance} aria-label="Cancel guidance" className="text-black/30 hover:text-black/60">
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <p className="text-xs text-black/50">
          Ride as normal. Once you get off — even if it's before {destination.name} — tap below and we'll walk you the rest of the way.
        </p>
        <button onClick={markAlighted} className="btn-primary w-full !py-2 text-xs font-bold flex items-center justify-center gap-1.5">
          <Footprints size={13} strokeWidth={2} />
          I've Alighted Here
        </button>
      </div>
    );
  }

  // Alighted — live walking guidance.
  const distance = location ? haversineMeters(location.lat, location.lng, destination.lat, destination.lng) : null;
  const bearing = location ? bearingDegrees(location.lat, location.lng, destination.lat, destination.lng) : null;
  const arrived = distance !== null && distance < 60;

  return (
    <div className="rounded-xl bg-county-black p-5 text-white shadow-xl border border-white/10 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1.5">
          <Footprints size={13} strokeWidth={2.5} />
          Walking to {destination.name}
        </span>
        <button onClick={clearGuidance} aria-label="End guidance" className="text-white/40 hover:text-white/80">
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      {status === "denied" || status === "unsupported" ? (
        <div className="space-y-2">
          <p className="text-xs text-white/60">Enable location to see live distance and direction.</p>
          <button onClick={request} className="btn-primary w-full !py-2 text-xs font-bold">
            Enable Location
          </button>
        </div>
      ) : !location ? (
        <p className="text-xs text-white/60">Getting your location…</p>
      ) : arrived ? (
        <div className="flex items-center gap-2 text-county-green">
          <CheckCircle2 size={18} strokeWidth={2} />
          <span className="text-sm font-extrabold">You've arrived at {destination.name}!</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div
              className="h-14 w-14 rounded-full bg-white/10 flex items-center justify-center shrink-0 transition-transform"
              style={{ transform: `rotate(${bearing}deg)` }}
            >
              <Navigation2 size={26} strokeWidth={2.5} className="text-county-yellow" />
            </div>
            <div>
              <div className="text-2xl font-black">{formatDistance(distance!)}</div>
              <div className="text-xs font-semibold text-white/60">
                {formatWalkingEta(distance!)} · head {cardinalDirection(bearing!)}
              </div>
            </div>
          </div>
          <WalkingMap myLat={location.lat} myLng={location.lng} destLat={destination.lat} destLng={destination.lng} />
        </>
      )}
    </div>
  );
}

/**
 * A small in-app TomTom map (same SDK/key as GisMap.tsx) showing the
 * passenger's live position and the destination with a straight line
 * between them — the visual counterpart to the compass arrow above,
 * entirely within this app rather than a link out to Google/Apple Maps.
 */
function WalkingMap({ myLat, myLng, destLat, destLng }: { myLat: number; myLng: number; destLat: number; destLng: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const meMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Mount the map once.
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
        mapLibre: { container: containerRef.current, center: [myLng, myLat], zoom: 15 },
      });
      mapRef.current = map;

      const meEl = document.createElement("div");
      meEl.style.width = "14px";
      meEl.style.height = "14px";
      meEl.style.borderRadius = "50%";
      meEl.style.background = "#0F47AF";
      meEl.style.border = "2px solid #ffffff";
      meEl.style.boxShadow = "0 0 0 4px rgba(15,71,175,0.3)";

      const destEl = document.createElement("div");
      destEl.style.width = "16px";
      destEl.style.height = "16px";
      destEl.style.borderRadius = "50% 50% 50% 0";
      destEl.style.transform = "rotate(-45deg)";
      destEl.style.background = "#FCDD07";
      destEl.style.border = "2px solid #ffffff";

      const readyCheck = setInterval(() => {
        if (destroyed) {
          clearInterval(readyCheck);
          return;
        }
        if (!map.mapReady) return;
        clearInterval(readyCheck);
        const glMap = map.mapLibreMap;

        glMap.addSource("walk-line", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[myLng, myLat], [destLng, destLat]] } },
        });
        glMap.addLayer({
          id: "walk-line-layer",
          type: "line",
          source: "walk-line",
          paint: { "line-color": "#FCDD07", "line-width": 2.5, "line-dasharray": [1.5, 1.5], "line-opacity": 0.8 },
        });

        meMarkerRef.current = new maplibregl.Marker({ element: meEl }).setLngLat([myLng, myLat]).addTo(glMap);
        destMarkerRef.current = new maplibregl.Marker({ element: destEl }).setLngLat([destLng, destLat]).addTo(glMap);

        const bounds = new maplibregl.LngLatBounds([myLng, myLat], [myLng, myLat]).extend([destLng, destLat]);
        glMap.fitBounds(bounds, { padding: 48, maxZoom: 17, duration: 0 });
        glMap.once("load", () => glMap.resize());
        setTimeout(() => glMap.resize(), 50);
        setReady(true);
      }, 100);
    })();

    return () => {
      destroyed = true;
      mapRef.current?.mapLibreMap.remove();
      mapRef.current = null;
    };
    // Only ever mounted once per alighting — the destination is fixed and
    // position updates are applied imperatively below, not by remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live position updates: move the marker and redraw the line without
  // rebuilding the map.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    meMarkerRef.current?.setLngLat([myLng, myLat]);
    const glMap = mapRef.current.mapLibreMap;
    const source = glMap.getSource("walk-line");
    if (source) {
      source.setData({
        type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: [[myLng, myLat], [destLng, destLat]] },
      });
    }
  }, [myLat, myLng, destLat, destLng, ready]);

  if (!TOMTOM_API_KEY) return null;

  return <div ref={containerRef} className="w-full h-40 rounded-lg overflow-hidden border border-white/10" />;
}
