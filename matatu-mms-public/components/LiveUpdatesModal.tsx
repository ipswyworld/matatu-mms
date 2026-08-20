"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, X, MapPin, AlertTriangle, CloudRain, Car, Siren, Construction, ShieldAlert, HelpCircle, Send } from "lucide-react";
import type { TomTomMap as TomTomMapType } from "@tomtom-org/maps-sdk/map";
import type { Marker as MaplibreMarker } from "maplibre-gl";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

// [36.7,-1.44] .. [37.1,-1.1] roughly bounds Nairobi; used only as the
// map's initial center, not for any filtering.
const NAIROBI_CENTER: [number, number] = [36.8228, -1.2864];

interface LiveVehicle {
  matatu_id: string;
  reg_number: string;
  route_code: string;
  lat: number;
  lng: number;
}

interface RouteAlert {
  route_code: string;
  route_name: string;
  from_stage: string;
  to_stage: string;
  description: string;
  since: string;
}

interface ConditionReportData {
  id: string;
  category: string;
  location_label: string;
  message?: string | null;
  created_at: string;
  report_count: number;
}

const CONDITION_META: Record<string, { label: string; icon: typeof CloudRain }> = {
  RAIN: { label: "Raining", icon: CloudRain },
  TRAFFIC_JAM: { label: "Traffic jam", icon: Car },
  ACCIDENT: { label: "Accident", icon: Siren },
  ROAD_BLOCKED: { label: "Road blocked", icon: Construction },
  POLICE_CHECK: { label: "Police check", icon: ShieldAlert },
  OTHER: { label: "Other", icon: HelpCircle },
};

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
  el.textContent = reg;
  return el;
}

/**
 * "Live Updates" — the one piece of the login screen that works with no
 * session at all: live vehicle positions (already broadcast on the
 * unauthenticated /ws/passengers channel that the booking map itself
 * uses) and active route detours (a separate public endpoint,
 * /api/public/route-alerts, deliberately not the staff-gated
 * /api/route-detours — see backend/app/routes/public_updates.py for why).
 * A modal rather than a page so it never disturbs whatever the visitor
 * was mid-typing in the sign-in form behind it.
 */
export default function LiveUpdatesModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 rounded-full bg-county-yellow px-4 py-2 text-xs font-extrabold text-county-black shadow-sm transition-transform hover:brightness-95 active:scale-[0.98]"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-county-red opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-county-red" />
        </span>
        <Radio size={13} strokeWidth={2.5} />
        Live Updates
      </button>

      {open && <LiveUpdatesPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function LiveUpdatesPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-black/5 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <Radio size={16} strokeWidth={2.5} className="text-county-red" />
            <h2 className="text-sm font-extrabold text-county-ink">Live Updates</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-county-ink/50 hover:bg-black/5 hover:text-county-ink"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <LiveMap />
          <RouteAlerts />
          <Conditions />
        </div>
      </div>
    </div>
  );
}

function LiveMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TomTomMapType | null>(null);
  const markersRef = useRef<Record<string, MaplibreMarker>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");

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
      mapRef.current = new TomTomMap({
        style: "standardDark",
        mapLibre: { container: containerRef.current, center: NAIROBI_CENTER, zoom: 11 },
      });

      // The modal mounts this container already at full size (unlike a
      // page-level map that grows into an empty layout slot), but
      // maplibre-gl still sometimes measures it a frame too early — the
      // GL context ends up sized to whatever the container was at
      // construction time and never repaints on its own after. An
      // explicit resize() once loaded, plus a second one a tick later for
      // the case where a parent re-layout still hadn't settled, forces a
      // correct repaint either way; cheap and idempotent if unnecessary.
      const glMap = mapRef.current.mapLibreMap;
      glMap.once("load", () => {
        glMap.resize();
        setTimeout(() => glMap.resize(), 50);
      });
    })();

    return () => {
      destroyed = true;
      mapRef.current?.mapLibreMap.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!TOMTOM_API_KEY) return;
    let cancelled = false;
    let attempt = 0;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (cancelled) return;
      const maplibregl = await import("maplibre-gl");
      setStatus("connecting");
      const ws = new WebSocket(`${WS_BASE_URL}/api/telemetry/ws/passengers`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("live");
      };

      const upsert = (v: LiveVehicle) => {
        const map = mapRef.current;
        if (!map) return;
        const glMap = map.mapLibreMap;
        const existing = markersRef.current[v.matatu_id];
        if (existing) {
          existing.setLngLat([v.lng, v.lat]);
        } else {
          const marker = new maplibregl.Marker({ element: vehicleMarkerElement(v.reg_number) })
            .setLngLat([v.lng, v.lat])
            .addTo(glMap);
          markersRef.current[v.matatu_id] = marker;
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "INIT_TELEMETRY") {
            (payload.vehicles || []).forEach(upsert);
          } else if (payload.type === "VEHICLE_POSITION_UPDATE" && payload.vehicle) {
            upsert(payload.vehicle);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus("offline");
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

  const dotColor = status === "live" ? "#068930" : status === "connecting" ? "#F5C518" : "#B4232C";

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold uppercase tracking-wide text-county-ink/50">
        <MapPin size={12} strokeWidth={2.5} />
        Vehicles on the road right now
      </div>
      <div className="relative rounded-xl overflow-hidden border border-black/10">
        {!TOMTOM_API_KEY ? (
          <div className="h-[220px] flex items-center justify-center bg-county-cream text-county-ink/40 text-xs font-semibold px-6 text-center">
            Live map unavailable right now.
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-[220px]" />
        )}
        {TOMTOM_API_KEY && (
          <span className="absolute top-2 right-2 flex h-2 w-2">
            {status !== "offline" && (
              <span
                className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: dotColor }}
              />
            )}
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />
          </span>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function RouteAlerts() {
  const [alerts, setAlerts] = useState<RouteAlert[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/public/route-alerts`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => !cancelled && setAlerts(data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold uppercase tracking-wide text-county-ink/50">
        <AlertTriangle size={12} strokeWidth={2.5} />
        Route alerts
      </div>
      {failed ? (
        <p className="text-sm text-county-red/80 py-3 text-center">Couldn't load route alerts right now. Try again shortly.</p>
      ) : alerts === null ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-county-cream animate-pulse" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-county-ink/50 py-3 text-center">No active alerts. All routes running as normal.</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={`${a.route_code}-${a.since}`} className="rounded-lg border border-county-yellow/30 bg-county-yellow/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-county-ink">
                  {a.route_code} · {a.route_name}
                </span>
                <span className="text-[10px] font-semibold text-county-ink/45 shrink-0">{timeAgo(a.since)}</span>
              </div>
              <p className="text-xs text-county-ink/70 mt-1 leading-relaxed">{a.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Crowdsourced conditions — "it's raining", "jam on Waiyaki Way" — anyone
 * can report with no login, no picking from a list of official stages.
 * Matching reports at the same rough location within the backend's 90-
 * minute freshness window collapse into one card with a corroboration
 * count, so this reads as the system "catching on", not a duplicate feed.
 */
function Conditions() {
  const [reports, setReports] = useState<ConditionReportData[] | null>(null);
  const [category, setCategory] = useState("RAIN");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReports = () => {
    fetch(`${API_BASE_URL}/api/public/conditions`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setReports)
      .catch(() => setReports([]));
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!location.trim()) {
      setError("Say roughly where — a road, stage, or area name.");
      return;
    }
    setError(null);
    setSubmitting(true);
    fetch(`${API_BASE_URL}/api/public/conditions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, location_label: location.trim() }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(() => {
        setSent(true);
        setLocation("");
        loadReports();
        setTimeout(() => setSent(false), 2000);
      })
      .catch(() => setError("Couldn't send that. Try again."))
      .finally(() => setSubmitting(false));
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold uppercase tracking-wide text-county-ink/50">
        <CloudRain size={12} strokeWidth={2.5} />
        What's happening on the road
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-black/10 bg-county-cream/50 p-3 space-y-2.5 mb-3">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(CONDITION_META).map(([key, meta]) => {
            const Icon = meta.icon;
            const active = category === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold border transition-colors ${
                  active
                    ? "bg-county-green text-white border-county-green"
                    : "bg-white text-county-ink/60 border-black/10 hover:border-county-green/40"
                }`}
              >
                <Icon size={11} strokeWidth={2.5} />
                {meta.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Where? e.g. Waiyaki Way"
            className="flex-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-county-green/30"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-county-green px-3 py-1.5 text-xs font-bold text-white flex items-center gap-1 shrink-0 disabled:opacity-50"
          >
            <Send size={12} strokeWidth={2.5} />
            {sent ? "Sent" : "Report"}
          </button>
        </div>
        {error && <p className="text-[11px] text-county-red font-semibold">{error}</p>}
      </form>

      {reports === null ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-county-cream animate-pulse" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-county-ink/50 py-2 text-center">No reports in the last 90 minutes.</p>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => {
            const meta = CONDITION_META[r.category] || CONDITION_META.OTHER;
            const Icon = meta.icon;
            return (
              <li key={r.id} className="rounded-lg border border-black/10 px-3 py-2 flex items-start gap-2">
                <Icon size={14} strokeWidth={2} className="text-county-ink/50 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-county-ink truncate">
                      {meta.label} · {r.location_label}
                    </span>
                    <span className="text-[10px] font-semibold text-county-ink/45 shrink-0">{timeAgo(r.created_at)}</span>
                  </div>
                  {r.message && <p className="text-xs text-county-ink/60 mt-0.5">{r.message}</p>}
                  {r.report_count > 1 && (
                    <span className="text-[10px] font-bold text-county-green">{r.report_count} people reported this</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
