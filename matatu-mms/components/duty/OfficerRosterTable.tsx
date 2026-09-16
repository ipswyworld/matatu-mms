"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { updateOfficerDutyStatusAction, updateOfficerServiceRecordAction } from "@/lib/actions";
import { DutyStatus, OfficerRoster } from "@/lib/types";
import DutyStatusPill from "./DutyStatusPill";

const DUTY_STATUSES: DutyStatus[] = ["ON_DUTY", "OFF_DUTY", "LEAVE", "SICK", "SUSPENDED", "TRAINING"];
// As printed on the county sheet. Free text on the backend deliberately —
// this list is the common set, not a closed vocabulary.
const RANKS = ["SUPT", "SCI", "INSP", "ACC III", "S/SGT", "SGT", "CPL", "CC"];

export default function OfficerRosterTable({
  officers,
  canEdit,
}: {
  officers: OfficerRoster[];
  canEdit: boolean;
}) {
  const onDuty = officers.filter((o) => o.dutyStatus === "ON_DUTY");
  const male = onDuty.filter((o) => o.gender === "M").length;
  const female = onDuty.filter((o) => o.gender === "F").length;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-county-black">Officer roster</h3>
          <p className="text-[11px] text-black/50 mt-0.5">
            Service record and duty status, as the allocation sheet records them.
          </p>
        </div>
        {/* The sheet's own footer, kept because the county reports on it. */}
        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wide">
          <span className="text-black/45">Male on duty <span className="text-county-black">{male}</span></span>
          <span className="text-black/45">Female on duty <span className="text-county-black">{female}</span></span>
          <span className="text-black/45">Total <span className="text-county-black">{officers.length}</span></span>
        </div>
      </div>

      {officers.length === 0 ? (
        <p className="text-xs text-black/40 italic">No officers match this filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wide text-black/40 border-b border-black/[0.07]">
                <th className="pb-2 pr-3">Officer</th>
                <th className="pb-2 pr-3">Man. No</th>
                <th className="pb-2 pr-3">Rank</th>
                <th className="pb-2 pr-3">Work station</th>
                <th className="pb-2 pr-3">Shift</th>
                <th className="pb-2 pr-3">Status</th>
                {canEdit && <th className="pb-2 w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.05]">
              {officers.map((officer) => (
                <OfficerRow key={officer.id} officer={officer} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OfficerRow({ officer, canEdit }: { officer: OfficerRoster; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [rank, setRank] = useState(officer.rank || "");
  const [manpowerNo, setManpowerNo] = useState(officer.manpowerNo || "");
  const [gender, setGender] = useState(officer.gender || "");
  const [status, setStatus] = useState<DutyStatus>(officer.dutyStatus);
  const [until, setUntil] = useState(officer.dutyStatusUntil || "");
  const [note, setNote] = useState(officer.dutyStatusNote || "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      // Two endpoints because they are two different records: the service
      // record (who this officer is) changes rarely, the duty status
      // changes constantly. Both are PATCHed here for one Save click.
      const service = await updateOfficerServiceRecordAction(officer.id, {
        manpowerNo: manpowerNo.trim() || null,
        rank: rank.trim() || null,
        gender: gender || null,
      });
      if (service.error) {
        setError(service.error);
        return;
      }
      if (
        status !== officer.dutyStatus ||
        until !== (officer.dutyStatusUntil || "") ||
        note !== (officer.dutyStatusNote || "")
      ) {
        const result = await updateOfficerDutyStatusAction(officer.id, {
          dutyStatus: status,
          dutyStatusUntil: until || null,
          dutyStatusNote: note.trim() || null,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
      }
      setEditing(false);
    });
  };

  if (editing) {
    return (
      <tr className="bg-county-cream/40">
        <td className="py-2 pr-3 text-xs font-bold text-county-black align-top">{officer.name}</td>
        <td className="py-2 pr-3 align-top">
          <input
            value={manpowerNo}
            onChange={(e) => setManpowerNo(e.target.value)}
            placeholder="74786"
            className="input text-[11px] w-20"
          />
        </td>
        <td className="py-2 pr-3 align-top">
          <select value={rank} onChange={(e) => setRank(e.target.value)} className="input text-[11px] w-24">
            <option value="">—</option>
            {RANKS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select value={gender} onChange={(e) => setGender(e.target.value)} className="input text-[11px] w-16 mt-1">
            <option value="">—</option>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </td>
        <td className="py-2 pr-3 text-[11px] text-black/50 align-top">{officer.workStation || "—"}</td>
        <td className="py-2 pr-3 text-[11px] text-black/50 align-top">{officer.shift || "—"}</td>
        <td className="py-2 pr-3 align-top">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as DutyStatus)}
            className="input text-[11px] w-28"
          >
            {DUTY_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
          {status !== "ON_DUTY" && (
            <>
              <input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                title="Back on duty"
                className="input text-[11px] w-32 mt-1"
              />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason"
                className="input text-[11px] w-32 mt-1"
              />
            </>
          )}
          {error && <p className="text-[10px] font-semibold text-county-red mt-1 max-w-[12rem]">{error}</p>}
        </td>
        <td className="py-2 align-top">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              aria-label="Save"
              className="text-county-green hover:text-county-green/70"
            >
              <Check size={15} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="Cancel"
              className="text-black/30 hover:text-black/60"
            >
              <X size={15} strokeWidth={2.5} />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="py-2 pr-3">
        <span className="block text-xs font-bold text-county-black">{officer.name}</span>
        <span className="block text-[10px] text-black/40">{officer.role.replace(/_/g, " ")}</span>
      </td>
      <td className="py-2 pr-3 text-[11px] font-mono text-black/60">{officer.manpowerNo || "—"}</td>
      <td className="py-2 pr-3 text-[11px] font-semibold text-black/70">
        {officer.rank || "—"}
        {officer.gender ? <span className="text-black/35 ml-1">({officer.gender})</span> : null}
      </td>
      <td className="py-2 pr-3 text-[11px] text-black/60">
        {officer.workStation || <span className="text-black/30 italic">Not posted</span>}
        {officer.zoneName && <span className="block text-[10px] text-black/35">{officer.zoneName}</span>}
      </td>
      <td className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wide text-black/50">
        {officer.shift || "—"}
        {officer.coverage && officer.coverage !== "DAILY" && (
          <span className="block text-county-yellow-dark">{officer.coverage}</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <DutyStatusPill status={officer.dutyStatus} />
        {officer.dutyStatusUntil && (
          <span className="block text-[10px] text-black/40 mt-0.5">
            until {officer.dutyStatusUntil}
          </span>
        )}
      </td>
      {canEdit && (
        <td className="py-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${officer.name}`}
            className="text-black/25 hover:text-county-green"
          >
            <Pencil size={13} strokeWidth={2} />
          </button>
        </td>
      )}
    </tr>
  );
}
