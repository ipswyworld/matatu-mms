"use client";

import { useEffect, useState } from "react";
import { Radio, AlertTriangle, CloudRain, Car, Siren, Construction, ShieldAlert, HelpCircle } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
const POLL_MS = 30000;

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
  source: "CROWDSOURCED" | "TOMTOM";
}

const CONDITION_META: Record<string, { label: string; icon: typeof CloudRain }> = {
  RAIN: { label: "Raining", icon: CloudRain },
  TRAFFIC_JAM: { label: "Traffic jam", icon: Car },
  ACCIDENT: { label: "Accident", icon: Siren },
  ROAD_BLOCKED: { label: "Road blocked", icon: Construction },
  POLICE_CHECK: { label: "Police check", icon: ShieldAlert },
  OTHER: { label: "Other", icon: HelpCircle },
};

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Admin-dashboard counterpart to the public login page's Live Updates
 * modal (matatu-mms-public/components/LiveUpdatesModal.tsx): same two
 * public, unauthenticated endpoints (route-alerts + crowdsourced
 * conditions), read-only here since staff have their own official
 * route-detour tooling elsewhere — this panel is for *seeing* what
 * passengers/crew are reporting, not adding to it.
 */
export default function LiveConditions() {
  const [alerts, setAlerts] = useState<RouteAlert[] | null>(null);
  const [conditions, setConditions] = useState<ConditionReportData[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_BASE_URL}/api/public/route-alerts`)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => !cancelled && setAlerts(data))
        .catch(() => !cancelled && setAlerts([]));
      fetch(`${API_BASE_URL}/api/public/conditions`)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => !cancelled && setConditions(data))
        .catch(() => !cancelled && setConditions([]));
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const loading = alerts === null && conditions === null;
  const hasNothing = (alerts?.length ?? 0) === 0 && (conditions?.length ?? 0) === 0;

  return (
    <div className="rounded-2xl bg-white p-5 md:p-6 shadow-sm ring-1 ring-county-ink/[0.06]">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-county-red opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-county-red" />
          </span>
          <div>
            <h3 className="font-black text-county-ink text-base tracking-tight flex items-center gap-1.5">
              <Radio size={14} strokeWidth={2.5} className="text-county-red" />
              Live conditions
            </h3>
            <p className="text-[11px] text-county-ink/50 mt-1">Crowdsourced reports + live TomTom traffic data</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-xl bg-county-cream/60 animate-pulse" />
          ))}
        </div>
      ) : hasNothing ? (
        <p className="text-sm text-county-ink/40 py-6 text-center">No route alerts or condition reports in the last 90 minutes.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {alerts?.map((a) => (
            <div key={`${a.route_code}-${a.since}`} className="rounded-xl bg-county-yellow/10 ring-1 ring-county-yellow/30 p-3 flex items-start gap-2">
              <AlertTriangle size={14} strokeWidth={2} className="text-county-ink/50 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-county-ink truncate">{a.route_code} · {a.route_name}</span>
                  <span className="text-[10px] font-semibold text-county-ink/45 shrink-0">{timeAgo(a.since)}</span>
                </div>
                <p className="text-xs text-county-ink/60 mt-0.5">{a.description}</p>
              </div>
            </div>
          ))}
          {conditions?.map((r) => {
            const meta = CONDITION_META[r.category] || CONDITION_META.OTHER;
            const Icon = meta.icon;
            return (
              <div key={r.id} className="rounded-xl bg-county-cream/60 ring-1 ring-county-ink/[0.05] p-3 flex items-start gap-2">
                <Icon size={14} strokeWidth={2} className="text-county-ink/50 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-county-ink truncate">{meta.label} · {r.location_label}</span>
                    <span className="text-[10px] font-semibold text-county-ink/45 shrink-0">{timeAgo(r.created_at)}</span>
                  </div>
                  {r.message && <p className="text-xs text-county-ink/60 mt-0.5">{r.message}</p>}
                  <div className="flex items-center gap-2 mt-0.5">
                    {r.source === "TOMTOM" ? (
                      <span className="text-[10px] font-bold text-county-blue">TomTom traffic data</span>
                    ) : (
                      r.report_count > 1 && (
                        <span className="text-[10px] font-bold text-county-green">{r.report_count} reports</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
