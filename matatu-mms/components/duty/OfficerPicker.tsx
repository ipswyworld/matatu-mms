"use client";

import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { OfficerRoster } from "@/lib/types";
import DutyStatusPill from "./DutyStatusPill";

// As printed on the county's allocation sheet, senior first. Kept in rank
// order rather than alphabetical because that is how a commander scans a
// roster — "who are my sergeants" is a real question, "who starts with C"
// is not.
export const PTCU_RANKS = ["SUPT", "SCI", "INSP", "ACC III", "S/SGT", "SGT", "CPL", "CC"];

interface OfficerPickerProps {
  officers: OfficerRoster[];
  value: string;
  onChange: (officerId: string) => void;
  label?: string;
}

/**
 * Type-to-find officer picker.
 *
 * A <select> works for the four seeded demo accounts and collapses
 * completely at the real establishment — the September sheet lists 153
 * officers, and scrolling a native dropdown to find "S/SGT Deplean
 * Chesire" is not a thing anyone will do twice. Filters on name and
 * manpower number together, with a rank filter beside it, because those
 * are the three things the sheet actually identifies an officer by.
 */
export default function OfficerPicker({ officers, value, onChange, label = "Officer" }: OfficerPickerProps) {
  const [query, setQuery] = useState("");
  const [rank, setRank] = useState("");

  const selected = officers.find((o) => o.id === value) || null;

  // Ranks actually present, in sheet order, plus anything unrecognised
  // appended — a new rank on next month's sheet must still be filterable
  // without a code change.
  const availableRanks = useMemo(() => {
    const present = new Set(officers.map((o) => o.rank).filter(Boolean) as string[]);
    const known = PTCU_RANKS.filter((r) => present.has(r));
    const extra = [...present].filter((r) => !PTCU_RANKS.includes(r)).sort();
    return [...known, ...extra];
  }, [officers]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return officers.filter((o) => {
      if (rank && o.rank !== rank) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        (o.manpowerNo || "").toLowerCase().includes(q) ||
        (o.rank || "").toLowerCase().includes(q)
      );
    });
  }, [officers, query, rank]);

  if (selected) {
    return (
      <div>
        <label className="text-[11px] font-bold text-black/50 block mb-1">{label}</label>
        <div className="flex items-center gap-2 rounded-lg border border-county-green/40 bg-county-green/[0.06] px-3 py-2">
          <Check size={14} strokeWidth={2.5} className="text-county-green shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-bold text-county-black truncate">
              {selected.rank ? `${selected.rank} ` : ""}
              {selected.name}
            </span>
            <span className="block text-[10px] text-black/45">
              {selected.manpowerNo ? `Man. No ${selected.manpowerNo}` : "No manpower number recorded"}
            </span>
          </span>
          <DutyStatusPill status={selected.dutyStatus} />
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Choose a different officer"
            className="text-black/30 hover:text-black/60 shrink-0"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="text-[11px] font-bold text-black/50 block mb-1">{label}</label>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search
            size={13}
            strokeWidth={2}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-black/30 pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a name or manpower number…"
            aria-label="Search officers by name or manpower number"
            className="input text-xs w-full !pl-7"
          />
        </div>
        {availableRanks.length > 0 && (
          <select
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            aria-label="Filter by rank"
            className="input text-xs w-full sm:w-auto sm:min-w-[6.5rem] shrink-0"
          >
            <option value="">All ranks</option>
            {availableRanks.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-black/[0.08] divide-y divide-black/[0.05]">
        {matches.length === 0 ? (
          <p className="text-[11px] text-black/40 italic px-3 py-3">
            No officer matches {query ? `"${query}"` : "that rank"}.
          </p>
        ) : (
          matches.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-county-green/[0.06] transition-colors"
            >
              <span className="badge bg-county-black/[0.05] text-county-black text-[9px] font-extrabold shrink-0 w-14 text-center">
                {o.rank || "—"}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-bold text-county-black truncate">{o.name}</span>
                {o.manpowerNo && (
                  <span className="block text-[10px] font-mono text-black/40">#{o.manpowerNo}</span>
                )}
              </span>
              {/* An officer on leave can still be posted — next month's
                  sheet is written while people are away — but the
                  commander should see it at the moment of choosing. */}
              {o.dutyStatus !== "ON_DUTY" && <DutyStatusPill status={o.dutyStatus} />}
            </button>
          ))
        )}
      </div>

      <p className="text-[10px] text-black/35 mt-1">
        {matches.length} of {officers.length} officers
      </p>
    </div>
  );
}
