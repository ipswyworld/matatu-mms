"use client";

import { useMemo, useState } from "react";
import { ChevronRight, MapPin, Radio, Users } from "lucide-react";
import { DutyAssignment, Sector, Zone } from "@/lib/types";
import DutyStatusPill from "./DutyStatusPill";

interface SectorZoneBrowserProps {
  sectors: Sector[];
  zones: Zone[];
  assignments: DutyAssignment[];
  /** Filters the officer list to postings that actually apply on this
   *  date — resolving DAILY vs WEEKEND coverage, same rule as the backend. */
  selectedDate: string | null;
  canBroadcast: boolean;
  onBroadcast: (target: { audience: "SECTOR" | "ZONE"; id: string; label: string }) => void;
}

function appliesOn(assignment: DutyAssignment, date: string | null): boolean {
  if (!date) return true;
  const day = new Date(`${date}T00:00:00`);
  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
  if (assignment.coverage === "WEEKEND" && !isWeekend) return false;
  if (assignment.coverage === "WEEKDAY" && isWeekend) return false;
  if (assignment.effectiveFrom && date < assignment.effectiveFrom) return false;
  if (assignment.effectiveTo && date > assignment.effectiveTo) return false;
  return true;
}

/**
 * The drill-down the commanders asked for: start at a sector, open it to
 * its zones, open a zone to the officers posted there.
 *
 * Everything filters client-side from one already-loaded allocation.
 * A full month's sheet is ~153 rows, so a round-trip per click would add
 * latency to every expand and buy nothing.
 */
export default function SectorZoneBrowser({
  sectors,
  zones,
  assignments,
  selectedDate,
  canBroadcast,
  onBroadcast,
}: SectorZoneBrowserProps) {
  const [openSectorId, setOpenSectorId] = useState<string | null>(null);
  const [openZoneId, setOpenZoneId] = useState<string | null>(null);

  const visible = useMemo(
    () => assignments.filter((a) => appliesOn(a, selectedDate)),
    [assignments, selectedDate]
  );

  const zonesBySector = useMemo(() => {
    const map = new Map<string, Zone[]>();
    for (const zone of zones) {
      if (!zone.sectorId) continue; // legacy corridor zones aren't part of the PTCU tree
      const list = map.get(zone.sectorId) || [];
      list.push(zone);
      map.set(zone.sectorId, list);
    }
    return map;
  }, [zones]);

  const bySector = useMemo(() => {
    const map = new Map<string, DutyAssignment[]>();
    for (const a of visible) {
      if (!a.sectorId) continue;
      const list = map.get(a.sectorId) || [];
      list.push(a);
      map.set(a.sectorId, list);
    }
    return map;
  }, [visible]);

  const byZone = useMemo(() => {
    const map = new Map<string, DutyAssignment[]>();
    for (const a of visible) {
      if (!a.zoneId) continue;
      const list = map.get(a.zoneId) || [];
      list.push(a);
      map.set(a.zoneId, list);
    }
    return map;
  }, [visible]);

  // Postings with no zone — sector command, MOBILE, GENERAL STORE. Real
  // rows on the sheet, and they would silently vanish if the drill-down
  // only ever showed zone-held postings.
  const sectorDirect = useMemo(() => {
    const map = new Map<string, DutyAssignment[]>();
    for (const a of visible) {
      if (!a.sectorId || a.zoneId) continue;
      const list = map.get(a.sectorId) || [];
      list.push(a);
      map.set(a.sectorId, list);
    }
    return map;
  }, [visible]);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-county-black">Daily duty &amp; zone assignment</h3>
          <p className="text-[11px] text-black/50 mt-0.5">
            Sector &rarr; zone &rarr; officers
            {selectedDate ? ` · showing ${new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}` : " · whole month"}
          </p>
        </div>
        <span className="text-[11px] font-semibold text-black/45">
          {visible.length} posting{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-2">
        {sectors.map((sector) => {
          const sectorZones = zonesBySector.get(sector.id) || [];
          const sectorPostings = bySector.get(sector.id) || [];
          const isOpen = openSectorId === sector.id;
          const direct = sectorDirect.get(sector.id) || [];

          return (
            <div key={sector.id} className="rounded-xl border border-black/[0.07] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setOpenSectorId(isOpen ? null : sector.id);
                  setOpenZoneId(null);
                }}
                aria-expanded={isOpen}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  isOpen ? "bg-county-green/[0.06]" : "bg-white hover:bg-black/[0.02]"
                }`}
              >
                <ChevronRight
                  size={15}
                  strokeWidth={2.5}
                  className={`text-black/30 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
                <span className="badge bg-county-black/[0.06] text-county-black text-[10px] font-extrabold shrink-0">
                  {sector.code}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-bold text-county-black truncate">{sector.name}</span>
                  <span className="block text-[10px] text-black/45 mt-0.5">
                    {sectorZones.length} zone{sectorZones.length === 1 ? "" : "s"}
                    {sector.commanderName ? ` · ${sector.commanderName}` : ""}
                    {sector.contactPhone ? ` · ${sector.contactPhone}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-black/55 shrink-0">
                  <Users size={13} strokeWidth={2} />
                  {sectorPostings.length}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-black/[0.06] bg-county-cream/40 px-3 py-3 space-y-2">
                  {canBroadcast && (
                    <button
                      type="button"
                      onClick={() =>
                        onBroadcast({ audience: "SECTOR", id: sector.id, label: `Sector ${sector.code} — ${sector.name}` })
                      }
                      className="flex items-center gap-1.5 text-[11px] font-bold text-county-green hover:underline"
                    >
                      <Radio size={12} strokeWidth={2.5} />
                      Broadcast to this sector
                    </button>
                  )}

                  {direct.length > 0 && (
                    <div className="rounded-lg bg-white border border-black/[0.06] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-black/40 mb-2">
                        Sector-level postings
                      </p>
                      <OfficerList assignments={direct} />
                    </div>
                  )}

                  {sectorZones.length === 0 && direct.length === 0 && (
                    <p className="text-[11px] text-black/40 italic px-1 py-2">
                      No zones or postings recorded for this sector yet.
                    </p>
                  )}

                  {sectorZones.map((zone) => {
                    const zonePostings = byZone.get(zone.id) || [];
                    const zoneOpen = openZoneId === zone.id;
                    return (
                      <div key={zone.id} className="rounded-lg border border-black/[0.06] bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setOpenZoneId(zoneOpen ? null : zone.id)}
                          aria-expanded={zoneOpen}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-black/[0.02] transition-colors"
                        >
                          <ChevronRight
                            size={13}
                            strokeWidth={2.5}
                            className={`text-black/25 shrink-0 transition-transform ${zoneOpen ? "rotate-90" : ""}`}
                          />
                          <MapPin size={12} strokeWidth={2} className="text-black/30 shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[11px] font-bold text-county-black truncate">
                              {zone.code ? `Zone ${zone.code} · ` : ""}
                              {zone.name}
                            </span>
                          </span>
                          <span className="text-[10px] font-bold text-black/50 shrink-0">
                            {zonePostings.length}
                          </span>
                        </button>

                        {zoneOpen && (
                          <div className="border-t border-black/[0.06] p-3 space-y-3">
                            {canBroadcast && (
                              <button
                                type="button"
                                onClick={() => onBroadcast({ audience: "ZONE", id: zone.id, label: zone.name })}
                                className="flex items-center gap-1.5 text-[11px] font-bold text-county-green hover:underline"
                              >
                                <Radio size={12} strokeWidth={2.5} />
                                Broadcast to this zone
                              </button>
                            )}
                            {zonePostings.length === 0 ? (
                              <p className="text-[11px] text-black/40 italic">
                                No officers posted to this zone{selectedDate ? " on this day" : ""}.
                              </p>
                            ) : (
                              <OfficerList assignments={zonePostings} />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OfficerList({ assignments }: { assignments: DutyAssignment[] }) {
  return (
    <ul className="divide-y divide-black/[0.05]">
      {assignments.map((a) => (
        <li key={a.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
          <span className="badge bg-county-black/[0.05] text-county-black text-[9px] font-extrabold shrink-0 mt-0.5">
            {a.officerRank || "—"}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[11px] font-bold text-county-black">
              {a.officerName}
              {a.officerManpowerNo && (
                <span className="font-mono font-normal text-black/40 ml-1.5">#{a.officerManpowerNo}</span>
              )}
            </span>
            <span className="block text-[10px] text-black/50 mt-0.5">
              {a.workStation}
              {a.postingRole ? ` · ${a.postingRole}` : ""}
            </span>
          </span>
          <span className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[9px] font-bold uppercase tracking-wide text-black/40">
              {a.shift}
              {a.coverage !== "DAILY" ? ` · ${a.coverage}` : ""}
            </span>
            <DutyStatusPill status={a.officerDutyStatus} />
          </span>
        </li>
      ))}
    </ul>
  );
}
