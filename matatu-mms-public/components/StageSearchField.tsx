"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { searchStagesAction } from "@/lib/actions";

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
}: {
  onSelect: (stage: StageOption) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StageOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleSelect = (stage: StageOption) => {
    onSelect(stage);
    setQuery("");
    setResults([]);
    setOpen(false);
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
          {results.length === 0 && !loading ? (
            <p className="px-3 py-3 text-xs text-black/40 text-center">No stage matches "{query}".</p>
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
