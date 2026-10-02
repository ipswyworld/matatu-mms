"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin, CheckCircle2, Bus, XCircle } from "lucide-react";
import GisMap from "@/components/GisMap";
import PreBoardingGuidance from "@/components/PreBoardingGuidance";
import { StageOption } from "@/components/StageSearchField";
import { createJourneyBookingAction } from "@/lib/actions";
import { Booking, MultiLegSearchResult } from "@/lib/types";

type Phase = "booking" | "leg1-preboard" | "leg1-riding" | "leg2-preboard" | "leg2-riding" | "arrived" | "error";

/**
 * One-transfer journey flow (Phase 9, #6) — a thin, self-contained wrapper
 * around primitives this session already built, not a rewrite of
 * PassengerBookingClient's own single-vehicle state machine. Books both
 * legs up front (no seat-hold mechanism exists for "book leg 2 only once
 * leg 1 actually arrives" — booking both immediately is the more honest
 * choice for a pay-on-board system with no reservation window), then
 * sequences: walk to leg 1's stage -> ride leg 1 -> walk/wait at the
 * transfer stage -> ride leg 2 -> arrived.
 */
export default function JourneyClient({
  journey,
  fromStage,
  toStage,
  passengerName,
  phone,
  seatNumbers,
  onExit,
}: {
  journey: MultiLegSearchResult;
  fromStage: StageOption;
  toStage: StageOption;
  passengerName: string;
  phone: string;
  seatNumbers: number[];
  /** Fires when the passenger cancels out of the journey view entirely
   * (before booking, or after an error) — the parent returns to the normal
   * search/booking flow. */
  onExit?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("booking");
  const [leg1Booking, setLeg1Booking] = useState<Booking | null>(null);
  const [leg2Booking, setLeg2Booking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await createJourneyBookingAction({
        leg1: { matatuId: journey.leg1.matatuId, routeId: journey.leg1.routeId, passengerName, phone, stageName: fromStage.name, seatNumbers },
        leg2: { matatuId: journey.leg2.matatuId, routeId: journey.leg2.routeId, passengerName, phone, stageName: journey.transferStageName, seatNumbers },
        transferStageId: journey.transferStageId,
      });
      if (cancelled) return;
      if (!result.leg1Booking) {
        setError(result.error || "Could not book this journey. Please try again.");
        setPhase("error");
        return;
      }
      setLeg1Booking(result.leg1Booking);
      if (result.leg2Booking) setLeg2Booking(result.leg2Booking);
      if (!result.leg2Booking) {
        setError(result.error || "Booked your first leg, but the second leg failed.");
      }
      setPhase("leg1-preboard");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "error") {
    return (
      <div className="card p-5 space-y-3 text-center">
        <XCircle size={28} className="text-county-red mx-auto" />
        <p className="text-sm font-bold text-county-black">{error}</p>
        <button type="button" onClick={onExit} className="btn-primary !py-2 text-xs font-bold">
          Back to search
        </button>
      </div>
    );
  }

  if (phase === "booking") {
    return (
      <div className="card p-6 flex flex-col items-center gap-3 text-center">
        <Loader2 size={22} className="animate-spin text-county-blue" />
        <p className="text-sm font-bold text-county-black">Booking both legs of your journey…</p>
      </div>
    );
  }

  const legLabel = phase === "leg1-preboard" || phase === "leg1-riding" ? "Leg 1 of 2" : "Leg 2 of 2";

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-county-yellow/10 text-county-black border border-county-yellow/30 rounded-lg p-2.5 text-xs font-semibold">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between text-[11px] font-bold text-county-black/50 uppercase tracking-wide">
        <span>{legLabel}</span>
        <span>Transfer at {journey.transferStageName}</span>
      </div>

      <GisMap
        embedded={false}
        fromStage={{ id: fromStage.id, name: fromStage.name, lat: fromStage.lat, lng: fromStage.lng }}
        toStage={{ id: toStage.id, name: toStage.name, lat: toStage.lat, lng: toStage.lng }}
        viaStage={{ id: journey.transferStageId, name: journey.transferStageName, lat: journey.transferStageLat, lng: journey.transferStageLng }}
        boardedMatatuId={phase === "leg1-riding" ? journey.leg1.matatuId : phase === "leg2-riding" ? journey.leg2.matatuId : null}
      />

      {phase === "leg1-preboard" && (
        <PreBoardingGuidance
          targetStage={{ id: fromStage.id, name: fromStage.name, lat: fromStage.lat, lng: fromStage.lng }}
          matatuId={journey.leg1.matatuId}
          onArrive={() => setPhase("leg1-riding")}
        />
      )}

      {phase === "leg1-riding" && (
        <div className="card p-4 flex items-center gap-2.5">
          <Bus size={18} className="text-county-blue shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-county-black">On {journey.leg1.regNumber}, Route {journey.leg1.routeCode}</p>
            <p className="text-xs text-black/50">Heading to {journey.transferStageName} — the map line follows the vehicle live.</p>
          </div>
          <button
            type="button"
            onClick={() => setPhase("leg2-preboard")}
            className="ml-auto text-xs font-bold text-county-blue hover:underline shrink-0"
          >
            I've arrived
          </button>
        </div>
      )}

      {phase === "leg2-preboard" && (
        <PreBoardingGuidance
          targetStage={{ id: journey.transferStageId, name: journey.transferStageName, lat: journey.transferStageLat, lng: journey.transferStageLng }}
          matatuId={journey.leg2.matatuId}
          onArrive={() => setPhase("leg2-riding")}
        />
      )}

      {phase === "leg2-riding" && (
        <div className="card p-4 flex items-center gap-2.5">
          <Bus size={18} className="text-county-blue shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-county-black">On {journey.leg2.regNumber}, Route {journey.leg2.routeCode}</p>
            <p className="text-xs text-black/50">Heading to {toStage.name} — the map line follows the vehicle live.</p>
          </div>
          <button
            type="button"
            onClick={() => setPhase("arrived")}
            className="ml-auto text-xs font-bold text-county-blue hover:underline shrink-0"
          >
            I've arrived
          </button>
        </div>
      )}

      {phase === "arrived" && (
        <div className="card p-5 text-center space-y-2">
          <CheckCircle2 size={26} className="text-county-green mx-auto" />
          <p className="text-sm font-extrabold text-county-black">You've arrived at {toStage.name}!</p>
          <button type="button" onClick={onExit} className="btn-primary !py-2 text-xs font-bold">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
