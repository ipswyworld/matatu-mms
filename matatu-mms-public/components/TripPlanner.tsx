"use client";

import { useEffect, useState } from "react";
import { ArrowUpDown, Bus, Footprints, Loader2, MapPin, Navigation, Accessibility } from "lucide-react";
import StageSearchField, { StageOption } from "@/components/StageSearchField";
import EmptyState from "@/components/EmptyState";
import { getNearestTerminalAction, searchMultiLegOriginDestinationAction, searchOriginDestinationAction } from "@/lib/actions";
import { usePassengerLocation } from "@/lib/geo";
import { MultiLegSearchResult, OriginDestinationResult } from "@/lib/types";

/**
 * Uber/Bolt-style "where from -> where to" trip search, replacing the old
 * boarding-stage-only dropdown. Wraps the backend's existing
 * GET /api/search/od (app/routes/search.py) — a fully-built, direction-
 * aware route matcher that had no frontend caller before this.
 *
 * If the passenger's destination isn't a known stage (freeform text with no
 * match), this falls back to directing them to their nearest real terminal
 * by GPS distance instead of failing outright — "known or unknown place,
 * still get directed somewhere real."
 */
export default function TripPlanner({
  onSelectMatatu,
  onSelectJourney,
  onFromChange,
  onToChange,
  onStartGuidance,
  guidanceActive,
  embedded = false,
}: {
  onSelectMatatu?: (matatuId: string) => void;
  /** Fires when the passenger picks a one-transfer itinerary (Phase 9, #6)
   * instead of a direct match — the parent hands this off to
   * JourneyClient.tsx rather than the normal single-vehicle booking flow. */
  onSelectJourney?: (journey: MultiLegSearchResult, fromStage: StageOption, toStage: StageOption) => void;
  /** Fires whenever the "From" stage changes — the parent booking flow uses
   * this as the passenger's real boarding stage name at booking time. */
  onFromChange?: (stage: StageOption) => void;
  /** Fires whenever the "To" stage changes — the parent uses this to draw
   * the destination pin/route on the map, the same stage this component
   * searches matatus against. */
  onToChange?: (stage: StageOption) => void;
  /** Fires when the passenger opts into on-foot guidance to the same "To"
   * stage they just searched for — replaces what used to be a second,
   * separate "tell us your destination" box (DestinationGuidance.tsx no
   * longer asks on its own; it only ever reuses this one). */
  onStartGuidance?: (stage: StageOption) => void;
  /** Whether on-foot guidance is already running for this trip, so the
   * toggle here reflects reality instead of resetting on every render. */
  guidanceActive?: boolean;
  /** When true, drop the standalone card/heading and render as a plain
   * light strip meant to dock directly beneath GisMap inside a shared
   * dark instrument container the parent owns (PassengerBookingClient) —
   * map and search read as one object instead of two stacked cards. */
  embedded?: boolean;
}) {
  const [from, setFrom] = useState<StageOption | null>(null);
  const [to, setTo] = useState<StageOption | null>(null);
  const [results, setResults] = useState<OriginDestinationResult[] | null>(null);
  const [multiLegResults, setMultiLegResults] = useState<MultiLegSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [nearestFallback, setNearestFallback] = useState<{ name: string; distanceMeters: number; wheelchairAccessible: boolean } | null>(null);
  const [accessibilityRequired, setAccessibilityRequired] = useState(false);
  const { location, request } = usePassengerLocation();

  const runSearch = async (fromStage: StageOption, toStage: StageOption) => {
    setSearching(true);
    setNearestFallback(null);
    setMultiLegResults([]);
    const matches = await searchOriginDestinationAction(fromStage.id, toStage.id);
    setResults(matches);
    setSearching(false);
    // A transfer is strictly a fallback to a direct ride — only look for
    // one once the direct search has genuinely come back empty.
    if (matches.length === 0) {
      const journeys = await searchMultiLegOriginDestinationAction(fromStage.id, toStage.id);
      setMultiLegResults(journeys);
    }
  };

  const handleSelectFrom = (stage: StageOption) => {
    setFrom(stage);
    onFromChange?.(stage);
    if (to) runSearch(stage, to);
  };

  const handleSelectTo = (stage: StageOption) => {
    setTo(stage);
    onToChange?.(stage);
    if (from) runSearch(from, stage);
  };

  const handleSwap = () => {
    if (!from || !to) return;
    setFrom(to);
    setTo(from);
    onFromChange?.(to);
    onToChange?.(from);
    runSearch(to, from);
  };

  // No matching direct route — fall back to "at least tell them the
  // nearest real terminal" rather than a dead end, using the passenger's
  // own live location if they've granted it.
  const findNearestTerminal = async () => {
    if (!location) {
      request();
      return;
    }
    const nearest = await getNearestTerminalAction(location.lat, location.lng, accessibilityRequired);
    setNearestFallback(nearest ? { name: nearest.name, distanceMeters: nearest.distanceMeters, wheelchairAccessible: nearest.wheelchairAccessible } : null);
  };

  // Auto-resolve rather than waiting for a manual tap, but only when
  // location is already granted — requesting it here (no direct user
  // gesture at this exact point) would silently fail in most browsers.
  // When it isn't granted yet, the manual button below still works.
  useEffect(() => {
    if (results && results.length === 0 && location && !nearestFallback) {
      findNearestTerminal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, location]);

  // Re-resolve when the accessibility toggle changes after a fallback is
  // already showing — a hard filter (Phase 7, #15), not a ranking bias, so
  // flipping it can genuinely change which terminal is "nearest".
  useEffect(() => {
    if (nearestFallback && location) {
      findNearestTerminal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibilityRequired]);

  const searchRow = (
    <div className="flex items-stretch gap-3">
      {/* Route connector: a filled dot for the boarding point, a pin for the
          destination, joined by a line — this alone tells "from vs to"
          without the uppercase micro-labels the old two-field form needed. */}
      <div className="flex flex-col items-center w-4 shrink-0 py-3.5">
        <span className="h-2.5 w-2.5 rounded-full bg-county-green shrink-0" />
        <span className="w-px flex-1 bg-county-ink/15 my-1" />
        <MapPin size={13} strokeWidth={2.5} className="text-county-red shrink-0" />
      </div>
      <div className="flex-1 min-w-0 divide-y divide-county-ink/10">
        <div className="py-2.5">
          <StageSearchField placeholder="Boarding point…" onSelect={handleSelectFrom} />
          {from && <p className="text-xs font-semibold text-county-green mt-1">{from.name}</p>}
        </div>
        <div className="py-2.5">
          <StageSearchField placeholder="Destination…" onSelect={handleSelectTo} />
          {to && <p className="text-xs font-semibold text-county-green mt-1">{to.name}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={handleSwap}
        disabled={!from || !to}
        aria-label="Swap from and to"
        className="self-center h-8 w-8 shrink-0 rounded-lg border border-black/10 bg-white flex items-center justify-center text-county-black/60 hover:bg-black/5 disabled:opacity-30"
      >
        <ArrowUpDown size={14} strokeWidth={2} />
      </button>
    </div>
  );

  const belowSearch = (
    <>
      {to && (
        <button
          type="button"
          onClick={() => onStartGuidance?.(to)}
          disabled={guidanceActive}
          className="w-full text-xs font-bold text-county-black/70 bg-black/5 hover:bg-black/10 disabled:opacity-60 rounded-lg px-3 py-2 flex items-center gap-2 transition-colors"
        >
          <Footprints size={13} strokeWidth={2} className="text-county-green shrink-0" />
          {guidanceActive
            ? `Guiding you on foot to ${to.name} after you alight`
            : `Also guide me on foot once I get off, all the way to ${to.name}`}
        </button>
      )}

      {searching && (
        <div className="flex items-center gap-2 text-xs text-black/50">
          <Loader2 size={13} className="animate-spin" />
          Finding matatus on this route…
        </div>
      )}

      {!searching && results && results.length === 0 && (
        <div className="space-y-3">
          <EmptyState
            title="No direct route found between these two stages"
            hint="You may need to change vehicles along the way, or board at a nearby terminal instead."
          />

          {multiLegResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold text-county-black/50 uppercase tracking-wide">
                1-transfer options
              </p>
              {multiLegResults.map((journey, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => from && to && onSelectJourney?.(journey, from, to)}
                  className="w-full text-left p-3 rounded-xl border border-black/10 bg-white hover:border-county-blue/40 transition-colors space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-county-black">
                      1 transfer via {journey.transferStageName}
                    </span>
                    <span className="text-xs font-extrabold text-county-green">KES {journey.totalFareKes.toFixed(0)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-black/50">
                    <Bus size={12} strokeWidth={2} className="shrink-0" />
                    Route {journey.leg1.routeCode} → Route {journey.leg2.routeCode}
                  </div>
                </button>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-[11px] font-semibold text-black/50 cursor-pointer">
            <input
              type="checkbox"
              checked={accessibilityRequired}
              onChange={(e) => setAccessibilityRequired(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-black/20 text-county-green focus:ring-county-green/30"
            />
            <Accessibility size={13} strokeWidth={2} className="text-county-ink/40" />
            Only show wheelchair-accessible terminals
          </label>
          {nearestFallback ? (
            <div className="text-xs font-semibold text-county-blue bg-county-blue/10 border border-county-blue/20 rounded-lg p-2.5 flex items-center gap-1.5">
              <Navigation size={13} strokeWidth={2.5} />
              Nearest terminal: {nearestFallback.name} ({(nearestFallback.distanceMeters / 1000).toFixed(1)} km away)
              {nearestFallback.wheelchairAccessible && (
                <span className="badge bg-county-green/10 text-county-green font-bold text-[10px] ml-auto">Accessible</span>
              )}
            </div>
          ) : location ? (
            <div className="flex items-center gap-2 text-xs text-black/50">
              <Loader2 size={13} className="animate-spin" />
              Finding your nearest terminal…
            </div>
          ) : (
            <button
              type="button"
              onClick={findNearestTerminal}
              className="text-xs font-bold text-county-blue hover:underline flex items-center gap-1"
            >
              <Navigation size={12} strokeWidth={2.5} />
              Find my nearest terminal instead
            </button>
          )}
        </div>
      )}

      {!searching && results && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => {
            // Live crowding, right in the results list — the data was
            // already returned per-result (seatsAvailable/capacity), it
            // just wasn't shown visually before now.
            const fillRatio = r.capacity > 0 ? 1 - r.seatsAvailable / r.capacity : 0;
            const crowdColor =
              fillRatio >= 0.85 ? "bg-county-red" : fillRatio >= 0.5 ? "bg-county-yellow" : "bg-county-green";
            return (
              <button
                key={r.matatuId}
                type="button"
                onClick={() => onSelectMatatu?.(r.matatuId)}
                className="w-full text-left p-3 rounded-xl border border-black/10 bg-white hover:border-county-green/50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-county-black/5 text-county-black/60 flex items-center justify-center">
                    <Bus size={16} strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-extrabold text-sm text-county-black">{r.regNumber}</div>
                    <div className="text-[11px] text-black/50">Route {r.routeCode} · {r.seatsAvailable} seats left</div>
                    <div className="h-1 w-24 rounded-full bg-black/10 overflow-hidden mt-1">
                      <div className={`h-full rounded-full ${crowdColor}`} style={{ width: `${Math.round(fillRatio * 100)}%` }} />
                    </div>
                  </div>
                </div>
                <span className="badge bg-county-green/10 text-county-green font-bold shrink-0">KES {r.fareKes}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="bg-white p-4 space-y-4">
        {searchRow}
        {belowSearch}
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-4">
      <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
        <MapPin size={15} strokeWidth={2} className="text-county-ink/50" />
        Where are you headed?
      </h3>
      {searchRow}
      {belowSearch}
    </div>
  );
}
