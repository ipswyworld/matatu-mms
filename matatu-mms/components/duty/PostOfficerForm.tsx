"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { createDutyAssignmentAction } from "@/lib/actions";
import { OfficerRoster, Sector, Zone } from "@/lib/types";
import OfficerPicker from "./OfficerPicker";

interface PostOfficerFormProps {
  allocationId: string;
  officers: OfficerRoster[];
  sectors: Sector[];
  zones: Zone[];
}

/**
 * Adds one row to the allocation — the digital equivalent of writing a
 * line on the sheet.
 *
 * Work station is free text on purpose: the sheet's WORK STATION column
 * carries things a dropdown of zones cannot ("MOBILE", "GENERAL STORE",
 * "I/C LOADING ZONE", "KWARE/NEW PUMWANI JUNC/SOLIDARITY/MERU/DC AREA"),
 * and forcing those into a fixed list would lose how the posting is
 * actually written and understood.
 */
export default function PostOfficerForm({ allocationId, officers, sectors, zones }: PostOfficerFormProps) {
  const [open, setOpen] = useState(false);
  const [officerId, setOfficerId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [workStation, setWorkStation] = useState("");
  const [shift, setShift] = useState("DAY");
  const [coverage, setCoverage] = useState("DAILY");
  const [postingRole, setPostingRole] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const ptcuZones = zones.filter((z) => z.sectorId);

  const submit = () => {
    setError(null);
    if (!officerId) return setError("Pick an officer.");
    if (!workStation.trim()) return setError("A posting needs a work station.");

    startTransition(async () => {
      const result = await createDutyAssignmentAction(allocationId, {
        officerId,
        workStation: workStation.trim(),
        zoneId: zoneId || null,
        // Only sent when no zone is chosen — the backend derives the sector
        // from the zone otherwise, and sending both risks disagreeing.
        sectorId: zoneId ? null : sectorId || null,
        shift,
        coverage,
        postingRole: postingRole.trim() || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOfficerId("");
      setWorkStation("");
      setPostingRole("");
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary !py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 w-full"
      >
        <UserPlus size={14} strokeWidth={2} />
        Post an officer
      </button>
    );
  }

  return (
    <div className="card p-5 space-y-3">
      <h3 className="font-bold text-sm text-county-black">Post an officer</h3>

      {error && (
        <div className="rounded-lg bg-county-red/10 border border-county-red/30 p-2.5 text-xs font-semibold text-county-red">
          {error}
        </div>
      )}

      <OfficerPicker officers={officers} value={officerId} onChange={setOfficerId} />

      <div>
        <label className="text-[11px] font-bold text-black/50 block mb-1">
          Zone <span className="font-normal text-black/35">(leave blank for mobile / store / sector command)</span>
        </label>
        <select
          value={zoneId}
          onChange={(e) => {
            setZoneId(e.target.value);
            const zone = ptcuZones.find((z) => z.id === e.target.value);
            // Prefill the work station with the zone name — it is what the
            // sheet usually says, and it stays editable for the cases where
            // the posting is a specific junction inside the zone.
            if (zone && !workStation.trim()) setWorkStation(zone.name);
          }}
          className="input text-xs w-full"
        >
          <option value="">No zone</option>
          {ptcuZones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.sectorCode ? `S${z.sectorCode} · ` : ""}
              {z.code ? `Zone ${z.code} · ` : ""}
              {z.name}
            </option>
          ))}
        </select>
      </div>

      {!zoneId && (
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Sector</label>
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} className="input text-xs w-full">
            <option value="">No sector</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                Sector {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="text-[11px] font-bold text-black/50 block mb-1">Work station</label>
        <input
          value={workStation}
          onChange={(e) => setWorkStation(e.target.value)}
          placeholder="e.g. Khoja / Kilome Road, or MOBILE"
          className="input text-xs w-full"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Shift</label>
          <select value={shift} onChange={(e) => setShift(e.target.value)} className="input text-xs w-full">
            <option value="DAY">Day</option>
            <option value="NOON">Noon</option>
            <option value="NIGHT">Night</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Applies</label>
          <select value={coverage} onChange={(e) => setCoverage(e.target.value)} className="input text-xs w-full">
            <option value="DAILY">Every day</option>
            <option value="WEEKDAY">Weekdays only</option>
            <option value="WEEKEND">Weekends only</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-[11px] font-bold text-black/50 block mb-1">
          Posting role <span className="font-normal text-black/35">(optional)</span>
        </label>
        <input
          value={postingRole}
          onChange={(e) => setPostingRole(e.target.value)}
          placeholder="e.g. I/C, Deputy Commander"
          className="input text-xs w-full"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="btn-primary flex-1 !py-2.5 text-xs font-bold"
        >
          {isPending ? "Posting…" : "Add posting"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-secondary !py-2.5 !px-4 text-xs font-bold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
