"use client";

import { useState, useTransition } from "react";
import { updateOfficerAssignmentAction } from "@/lib/actions";
import { OfficerAssignment, Zone } from "@/lib/types";

export default function OfficerAssignmentRow({ officer, zones }: { officer: OfficerAssignment; zones: Zone[] }) {
  const [duty, setDuty] = useState(officer.enforcementDuty || "");
  const [zoneId, setZoneId] = useState(officer.assignedZoneId || "");
  const [commanderTitle, setCommanderTitle] = useState(officer.commanderTitle || "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isCommander = officer.role === "ENFORCEMENT_COMMANDER";

  const handleSave = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateOfficerAssignmentAction(officer.id, {
        enforcementDuty: duty || null,
        assignedZoneId: zoneId || null,
        commanderTitle: commanderTitle || null,
      });
      if (result.error) { setError(result.error); return; }
      setSaved(true);
    });
  };

  return (
    <tr className="hover:bg-black/[0.02] align-top">
      <td className="p-2.5">
        <div className="font-semibold text-county-black">{officer.name}</div>
        <div className="text-[10px] text-black/50">{officer.email}</div>
      </td>
      <td className="p-2.5 text-black/60">{officer.role.replace(/_/g, " ")}</td>
      <td className="p-2.5">
        {isCommander ? (
          <input
            value={commanderTitle}
            onChange={(e) => setCommanderTitle(e.target.value)}
            placeholder="e.g. Commander of Traffic"
            className="text-[11px] border border-black/15 rounded px-2 py-1 w-full"
          />
        ) : (
          <select value={duty} onChange={(e) => setDuty(e.target.value)} className="text-[11px] border border-black/15 rounded px-2 py-1 w-full">
            <option value="">Unassigned</option>
            <option value="ARRESTING">Arresting Officer (today)</option>
            <option value="RELEASING">Releasing Officer (today)</option>
          </select>
        )}
      </td>
      <td className="p-2.5">
        {!isCommander && (
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="text-[11px] border border-black/15 rounded px-2 py-1 w-full">
            <option value="">No zone</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        )}
      </td>
      <td className="p-2.5">
        <button disabled={isPending} onClick={handleSave} className="btn-secondary !py-1 !px-2.5 text-[11px] font-bold">
          {isPending ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-[10px] text-county-green font-bold ml-1.5">Saved</span>}
        {error && <div className="text-[10px] text-county-red font-semibold mt-1">{error}</div>}
      </td>
    </tr>
  );
}
