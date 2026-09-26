"use client";

import { useEffect, useState } from "react";

/** Great-circle distance in meters — accurate enough at city scale, no external dependency. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// A stationary/crawling matatu (traffic, waiting to fill up) shouldn't
// produce a multi-hour ETA — floor the speed used for the estimate at a
// plausible "still approaching in real traffic" pace instead of the raw
// (possibly near-zero) reported speed.
const MIN_ETA_SPEED_KMH = 12;

/** Raw minutes, for feasibility comparisons — formatEta() wraps this for display. */
export function etaMinutes(meters: number, speedKmh: number): number {
  const effectiveSpeed = Math.max(speedKmh, MIN_ETA_SPEED_KMH);
  return (meters / 1000 / effectiveSpeed) * 60;
}

export function formatEta(meters: number, speedKmh: number): string {
  const minutes = Math.round(etaMinutes(meters, speedKmh));
  if (minutes < 1) return "under a minute away";
  if (minutes === 1) return "~1 min away";
  if (minutes > 60) return "over an hour away";
  return `~${minutes} min away`;
}

const WALKING_SPEED_KMH = 4.5;

/** Raw minutes, for feasibility comparisons — formatWalkingEta() wraps this for display. */
export function walkingEtaMinutes(meters: number): number {
  return (meters / 1000 / WALKING_SPEED_KMH) * 60;
}

export function formatWalkingEta(meters: number): string {
  const minutes = Math.round(walkingEtaMinutes(meters));
  if (minutes < 1) return "under a minute";
  if (minutes === 1) return "~1 min walk";
  if (minutes > 90) return "over 1.5 hr walk";
  return `~${minutes} min walk`;
}

/** Compass bearing (0-360, 0 = north) from point 1 to point 2 — which way to walk. */
export function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function cardinalDirection(bearing: number): string {
  return COMPASS_POINTS[Math.round(bearing / 45) % 8];
}

export type GeoStatus = "idle" | "locating" | "granted" | "denied" | "unsupported";

interface PassengerLocation {
  lat: number;
  lng: number;
}

/**
 * The passenger's own live location, opt-in and device-only — nothing is
 * ever sent to the backend. Distance/ETA (lib/geo.ts's haversineMeters +
 * formatEta) are computed entirely client-side against the already-public
 * live vehicle telemetry, the same way GisMap.tsx renders it.
 */
export function usePassengerLocation() {
  const [location, setLocation] = useState<PassengerLocation | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const watchIdRef = useState<{ current: number | null }>(() => ({ current: null }))[0];

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const request = () => {
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("granted");
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  };

  return { location, status, request };
}
