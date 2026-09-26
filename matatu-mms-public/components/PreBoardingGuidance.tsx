"use client";

import { useEffect, useRef } from "react";
import { Navigation2, Footprints, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  usePassengerLocation,
  haversineMeters,
  bearingDegrees,
  cardinalDirection,
  formatDistance,
  formatWalkingEta,
  walkingEtaMinutes,
  etaMinutes,
} from "@/lib/geo";
import { useLiveVehicles } from "@/lib/useLiveVehicles";
import { WalkingMap } from "@/components/DestinationGuidance";

interface TargetStage {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/**
 * The walk-to-your-boarding-point counterpart to DestinationGuidance.tsx's
 * post-alighting guidance — same math (haversineMeters/bearingDegrees/
 * formatWalkingEta), same WalkingMap visual (reused directly, not
 * duplicated), different point in the journey: this runs once a passenger
 * has picked a matatu and a boarding stage, before they've actually
 * boarded, instead of after they've gotten off.
 *
 * The one genuinely new piece is feasibility: comparing the passenger's own
 * walking ETA to the stage against the selected matatu's live ETA to that
 * same stage (both computed from real-time positions this app already
 * streams — no new backend data). There's no real departure-schedule data
 * behind an instant booking, so "the vehicle's ETA to the stage" is the
 * honest proxy for "how much time you actually have" — not a guarantee,
 * clearly framed as an estimate.
 */
export default function PreBoardingGuidance({
  targetStage,
  matatuId,
  onPickDifferent,
  onArrive,
}: {
  targetStage: TargetStage | null;
  /** The selected matatu's id, to compute feasibility against its live
   * position — omit to show walking guidance without the feasibility
   * comparison (e.g. before a vehicle has been picked yet). */
  matatuId?: string | null;
  /** Fires when the passenger taps "Pick a different matatu" after a
   * won't-make-it warning — the parent clears the selection so the
   * passenger can choose again from the existing search results. */
  onPickDifferent?: () => void;
  /** Fires once, the moment distance first drops below the 60m arrival
   * threshold (same threshold DestinationGuidance.tsx's post-alighting
   * guidance uses) — JourneyClient.tsx uses this to hand off from leg 1's
   * boarding wait into leg 2's, without duplicating the arrival math. */
  onArrive?: () => void;
}) {
  const { location, status, request } = usePassengerLocation();
  const liveVehicles = useLiveVehicles();
  const hasFiredArrive = useRef(false);

  const distance = location && targetStage ? haversineMeters(location.lat, location.lng, targetStage.lat, targetStage.lng) : null;
  const arrived = distance !== null && distance < 60;

  useEffect(() => {
    if (arrived && !hasFiredArrive.current) {
      hasFiredArrive.current = true;
      onArrive?.();
    }
    if (!arrived) hasFiredArrive.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  if (!targetStage) return null;

  const bearing = location ? bearingDegrees(location.lat, location.lng, targetStage.lat, targetStage.lng) : null;

  const vehicle = matatuId ? liveVehicles[matatuId] : null;
  const vehicleMinutes = vehicle
    ? etaMinutes(haversineMeters(vehicle.lat, vehicle.lng, targetStage.lat, targetStage.lng), vehicle.speed)
    : null;
  const walkMinutes = distance !== null ? walkingEtaMinutes(distance) : null;

  // "Won't make it": the matatu could realistically reach the stage well
  // before the passenger does. "Tight": it's close, worth hurrying for.
  // Both are estimates from live positions, not a real schedule — framed
  // as such in the copy below rather than a hard guarantee.
  const feasibility =
    vehicleMinutes !== null && walkMinutes !== null && !arrived
      ? walkMinutes - vehicleMinutes > 4
        ? "wont_make_it"
        : walkMinutes - vehicleMinutes > 0
        ? "tight"
        : "ok"
      : null;

  return (
    <div className="rounded-xl bg-county-black p-5 text-white shadow-xl border border-white/10 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1.5">
          <Footprints size={13} strokeWidth={2.5} />
          Walking to {targetStage.name}
        </span>
      </div>

      {status === "denied" || status === "unsupported" ? (
        <div className="space-y-2">
          <p className="text-xs text-white/60">Enable location to see live distance, direction, and whether you'll make it.</p>
          <button onClick={request} className="btn-primary w-full !py-2 text-xs font-bold">
            Enable Location
          </button>
        </div>
      ) : !location ? (
        <p className="text-xs text-white/60">Getting your location…</p>
      ) : arrived ? (
        <div className="flex items-center gap-2 text-county-green">
          <CheckCircle2 size={18} strokeWidth={2} />
          <span className="text-sm font-extrabold">You've arrived at {targetStage.name} — go ahead and board.</span>
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

          {feasibility === "wont_make_it" && (
            <div className="rounded-lg bg-county-red/20 border border-county-red/40 p-3 space-y-2">
              <div className="flex items-start gap-2 text-xs font-bold text-white">
                <AlertTriangle size={14} strokeWidth={2.5} className="text-county-red shrink-0 mt-0.5" />
                Based on your walking pace, this matatu could reach {targetStage.name} before you do. That's an
                estimate, not a guarantee, but it's worth picking a different one to be safe.
              </div>
              {onPickDifferent && (
                <button
                  type="button"
                  onClick={onPickDifferent}
                  className="text-xs font-bold text-white underline hover:no-underline"
                >
                  Pick a different matatu
                </button>
              )}
            </div>
          )}
          {feasibility === "tight" && (
            <div className="rounded-lg bg-county-yellow/20 border border-county-yellow/40 p-2.5 text-xs font-bold text-county-yellow flex items-center gap-2">
              <AlertTriangle size={13} strokeWidth={2.5} className="shrink-0" />
              It's going to be tight — the matatu isn't far off either. Hurry if you can.
            </div>
          )}

          <WalkingMap myLat={location.lat} myLng={location.lng} destLat={targetStage.lat} destLng={targetStage.lng} />
        </>
      )}
    </div>
  );
}
