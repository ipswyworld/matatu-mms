"use client";

import { useEffect, useRef, useState } from "react";
import { Bus, MapPin, Clock, RefreshCw } from "lucide-react";
import { getScheduledBookingShareAction } from "@/lib/actions";
import { ScheduledBookingShare } from "@/lib/types";

const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
// Matches the crew telemetry socket's STALE_AFTER_SECONDS (telemetry.py) —
// no point polling faster than the position itself can change.
const POLL_INTERVAL_MS = 15_000;

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Booked, awaiting confirmation",
  CONFIRMED: "Confirmed",
  BOARDED: "On the way",
  NO_SHOW: "Missed — passenger did not board",
  CANCELLED: "Cancelled",
  REASSIGNED: "Vehicle changed — new one not yet confirmed",
};

/** A single-marker live map, deliberately simpler than DestinationGuidance's
 * WalkingMap: a trusted contact has no "my location" of their own to plot,
 * just the one vehicle. */
function LiveVehicleMap({ lat, lng }: { lat: number; lng: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

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
        mapLibre: { container: containerRef.current, center: [lng, lat], zoom: 14 },
      });
      mapRef.current = map;

      const el = document.createElement("div");
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.borderRadius = "50%";
      el.style.background = "#00A651";
      el.style.border = "3px solid #ffffff";
      el.style.boxShadow = "0 0 0 5px rgba(0,166,81,0.3)";

      const readyCheck = setInterval(() => {
        if (destroyed) { clearInterval(readyCheck); return; }
        if (!map.mapReady) return;
        clearInterval(readyCheck);
        markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map.mapLibreMap);
        setTimeout(() => map.mapLibreMap.resize(), 50);
      }, 100);
    })();
    return () => {
      destroyed = true;
      mapRef.current?.mapLibreMap.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markerRef.current?.setLngLat([lng, lat]);
    mapRef.current?.mapLibreMap.easeTo({ center: [lng, lat], duration: 800 });
  }, [lat, lng]);

  if (!TOMTOM_API_KEY) return null;
  return <div ref={containerRef} className="h-56 w-full rounded-xl overflow-hidden border border-black/10" />;
}

export default function ShareTripClient({ token, initial }: { token: string; initial: ScheduledBookingShare | null }) {
  const [data, setData] = useState(initial);
  const [notFound, setNotFound] = useState(initial === null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const fresh = await getScheduledBookingShareAction(token);
      if (fresh) {
        setData(fresh);
        setNotFound(false);
      } else {
        setNotFound(true);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token]);

  if (notFound || !data) {
    return (
      <div className="text-center py-8">
        <p className="text-sm font-bold text-county-black">This share link isn't available</p>
        <p className="text-xs text-black/50 mt-1">It may have expired, or the trip may have ended.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="badge font-bold bg-county-blue/10 text-county-blue">{STATUS_LABEL[data.status] || data.status}</span>
        {data.livePosition && (
          <span className="text-[10px] text-county-green font-bold flex items-center gap-1">
            <RefreshCw size={10} strokeWidth={2.5} /> Live
          </span>
        )}
      </div>

      <div className="space-y-2 text-sm">
        {data.routeName && (
          <div className="flex items-center gap-2 text-county-black">
            <Bus size={15} strokeWidth={2} className="text-county-ink/50 shrink-0" />
            {data.routeName}{data.regNumber ? ` · ${data.regNumber}` : ""}
          </div>
        )}
        {data.originStageName && (
          <div className="flex items-center gap-2 text-county-black/70">
            <MapPin size={15} strokeWidth={2} className="text-county-ink/50 shrink-0" />
            {data.originStageName}{data.destinationStageName ? ` → ${data.destinationStageName}` : ""}
          </div>
        )}
        <div className="flex items-center gap-2 text-county-black/70">
          <Clock size={15} strokeWidth={2} className="text-county-ink/50 shrink-0" />
          {new Date(data.scheduledDeparture).toLocaleString()}
        </div>
      </div>

      {data.livePosition ? (
        <LiveVehicleMap lat={data.livePosition.lat} lng={data.livePosition.lng} />
      ) : (
        <div className="bg-black/5 rounded-xl p-4 text-center text-xs text-black/40">
          No live position yet — this appears once the vehicle is on the move.
        </div>
      )}

      <p className="text-[10px] text-black/30 text-center">Updates automatically every 15 seconds.</p>
    </div>
  );
}
