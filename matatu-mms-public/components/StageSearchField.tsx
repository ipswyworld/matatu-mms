"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, LocateFixed } from "lucide-react";
import { getNearestTerminalAction, getReachableDestinationsAction, searchStagesAction } from "@/lib/actions";
import { usePassengerLocation } from "@/lib/geo";

export interface StageOption {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/**
 * Free-text search over the real BRN stage list (hundreds of real stops),
 * the passenger types a place and picks from live suggestions rather than
 * scrolling a fixed dropdown. Originally private to DestinationGuidance.tsx
 * (the "guide me after alighting" feature); extracted here since
 * TripPlanner.tsx also needs an identical "type where you're going" field
 * for its origin/destination search.
 */
export default function StageSearchField({
  onSelect,
  placeholder = "Type where you're going… e.g. Church House",
  originStageId,
}: {
  onSelect: (stage: StageOption) => void;
  placeholder?: string;
  /** When set, this field is acting as a "destination" search: a typed
   * place that matches nothing falls back to "everywhere reachable from
   * this boarding stage" instead of a dead end — a passenger who doesn't
   * know the network's official stage names still gets somewhere real. */
  originStageId?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StageOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [resolvingNearest, setResolvingNearest] = useState(false);
  const [reachable, setReachable] = useState<StageOption[] | null>(null);
  const [loadingReachable, setLoadingReachable] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResolvingRef = useRef(false);
  const { location, status: geoStatus, request: requestLocation } = usePassengerLocation();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const matches = await searchStagesAction(query);
      setResults(matches);
      setLoading(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Zero direct matches on a destination field: load what's actually
  // reachable from the origin instead of leaving the passenger stuck.
  useEffect(() => {
    if (!originStageId || loading || results.length > 0 || query.trim().length < 2) {
      setReachable(null);
      return;
    }
    setLoadingReachable(true);
    getReachableDestinationsAction(originStageId).then((stages) => {
      setReachable(stages);
      setLoadingReachable(false);
    });
  }, [originStageId, loading, results.length, query]);

  // Origin field, zero matches, location already granted: resolve the
  // nearest real stage immediately rather than making the passenger
  // notice and tap a small link first — the permission itself still
  // needed an earlier explicit gesture, so no new prompt fires here.
  useEffect(() => {
    if (
      !originStageId && !loading && results.length === 0 && query.trim().length >= 2 &&
      location && !resolvingNearest && !autoResolvingRef.current
    ) {
      autoResolvingRef.current = true;
      handleUseNearest().finally(() => {
        autoResolvingRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, results.length, location]);

  const handleSelect = (stage: StageOption) => {
    onSelect(stage);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  // A typed place with no real stage match (e.g. "Muthua", a neighborhood
  // with no terminal of its own) used to be a dead end — the passenger had
  // no way to proceed. If they've already granted location, resolve
  // straight to the nearest real stage instead of leaving them stuck;
  // if not yet granted, this same tap requests it (a real user gesture,
  // so the browser's permission prompt is expected here).
  const handleUseNearest = async () => {
    if (!location) {
      requestLocation();
      return;
    }
    setResolvingNearest(true);
    const nearest = await getNearestTerminalAction(location.lat, location.lng);
    setResolvingNearest(false);
    if (nearest) {
      handleSelect({ id: nearest.id, name: nearest.name, lat: nearest.lat, lng: nearest.lng });
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="input pl-8 text-xs w-full"
        />
        {loading && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-black/30" />}
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-black/10 bg-white shadow-lg max-h-56 overflow-y-auto scrollbar-ghost">
          {results.length === 0 && !loading && originStageId ? (
            <div className="py-1">
              <p className="text-xs text-black/40 px-3 py-2">
                No stage matches "{query}" — here's where you can actually go from your boarding stage:
              </p>
              {loadingReachable ? (
                <div className="px-3 py-3 flex items-center gap-1.5 text-xs text-black/40">
                  <Loader2 size={12} className="animate-spin" />
                  Finding reachable destinations…
                </div>
              ) : reachable && reachable.length > 0 ? (
                reachable.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={() => handleSelect(s)}
                    className="block w-full text-left px-3 py-2 text-xs font-semibold text-county-black hover:bg-county-green/10"
                  >
                    {s.name}
                  </button>
                ))
              ) : (
                <p className="text-xs text-black/40 px-3 pb-2">No destinations found from that stage yet.</p>
              )}
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="px-3 py-3 space-y-2 text-center">
              <p className="text-xs text-black/40">No stage matches "{query}".</p>
              <button
                type="button"
                onMouseDown={handleUseNearest}
                disabled={resolvingNearest || geoStatus === "unsupported"}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-county-blue hover:underline disabled:opacity-50 disabled:no-underline"
              >
                <LocateFixed size={12} strokeWidth={2.5} />
                {resolvingNearest
                  ? "Finding the nearest stage…"
                  : geoStatus === "unsupported"
                  ? "Location unavailable on this device"
                  : location
                  ? "Use my current location instead"
                  : "Enable location to find the nearest stage"}
              </button>
            </div>
          ) : (
            results.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={() => handleSelect(s)}
                className="block w-full text-left px-3 py-2 text-xs font-semibold text-county-black hover:bg-county-green/10"
              >
                {s.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
