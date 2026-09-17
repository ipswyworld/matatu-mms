"use client";

import { useEffect, useState, useTransition } from "react";
import { Radio, Send, X } from "lucide-react";
import { sendBroadcastAction } from "@/lib/actions";
import { OfficerRoster, Sector, Zone } from "@/lib/types";
import OfficerPicker from "./OfficerPicker";

export interface BroadcastTarget {
  audience: "ALL" | "SECTOR" | "ZONE" | "OFFICER";
  id?: string;
  label?: string;
}

interface BroadcastComposerProps {
  sectors: Sector[];
  zones: Zone[];
  officers: OfficerRoster[];
  /** Set by the sector/zone browser when a commander clicks "broadcast to
   *  this zone" — the composer opens pre-addressed rather than making them
   *  re-pick a target they just had open. */
  presetTarget: BroadcastTarget | null;
  onClearPreset: () => void;
}

export default function BroadcastComposer({
  sectors,
  zones,
  officers,
  presetTarget,
  onClearPreset,
}: BroadcastComposerProps) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<BroadcastTarget["audience"]>("ALL");
  const [sectorId, setSectorId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [officerId, setOfficerId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentSummary, setSentSummary] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!presetTarget) return;
    setAudience(presetTarget.audience);
    setSectorId(presetTarget.audience === "SECTOR" ? presetTarget.id || "" : "");
    setZoneId(presetTarget.audience === "ZONE" ? presetTarget.id || "" : "");
    setOpen(true);
    setSentSummary(null);
    setError(null);
  }, [presetTarget]);

  const ptcuZones = zones.filter((z) => z.sectorId);

  const reset = () => {
    setSubject("");
    setBody("");
    setUrgent(false);
    setError(null);
    onClearPreset();
  };

  const handleSend = () => {
    setError(null);
    if (!subject.trim() || !body.trim()) {
      setError("A broadcast needs both a subject and a message.");
      return;
    }
    if (audience === "SECTOR" && !sectorId) return setError("Pick a sector.");
    if (audience === "ZONE" && !zoneId) return setError("Pick a zone.");
    if (audience === "OFFICER" && !officerId) return setError("Pick an officer.");

    startTransition(async () => {
      const result = await sendBroadcastAction({
        subject: subject.trim(),
        body: body.trim(),
        priority: urgent ? "URGENT" : "NORMAL",
        audience,
        sectorId: audience === "SECTOR" ? sectorId : null,
        zoneId: audience === "ZONE" ? zoneId : null,
        officerIds: audience === "OFFICER" ? [officerId] : undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSentSummary(
        `Sent to ${result.recipientCount} officer${result.recipientCount === 1 ? "" : "s"}.`
      );
      reset();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary !py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 w-full"
      >
        <Radio size={14} strokeWidth={2} />
        New broadcast
      </button>
    );
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
            <Radio size={14} strokeWidth={2} className="text-county-green" />
            Broadcast
          </h3>
          <p className="text-[11px] text-black/50 mt-0.5">
            Delivered live and kept on the officer&apos;s record, so it is still there if they were offline.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          aria-label="Close broadcast composer"
          className="text-black/30 hover:text-black/60"
        >
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>

      {sentSummary && (
        <div className="rounded-lg bg-county-green/10 border border-county-green/25 p-2.5 text-xs font-semibold text-county-green">
          {sentSummary}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-county-red/10 border border-county-red/30 p-2.5 text-xs font-semibold text-county-red">
          {error}
        </div>
      )}

      <div>
        <label className="text-[11px] font-bold text-black/50 block mb-1">Send to</label>
        <div className="grid grid-cols-4 gap-1.5">
          {(["ALL", "SECTOR", "ZONE", "OFFICER"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setAudience(option)}
              aria-pressed={audience === option}
              className={`text-[10px] font-bold uppercase tracking-wide rounded-lg py-2 border transition-colors ${
                audience === option
                  ? "border-county-green bg-county-green/10 text-county-green"
                  : "border-black/10 text-black/50 hover:border-county-green/40"
              }`}
            >
              {option === "ALL" ? "Everyone" : option === "OFFICER" ? "One officer" : option}
            </button>
          ))}
        </div>
      </div>

      {audience === "SECTOR" && (
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Sector</label>
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} className="input text-xs w-full">
            <option value="">Select a sector…</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                Sector {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {audience === "ZONE" && (
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Zone</label>
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input text-xs w-full">
            <option value="">Select a zone…</option>
            {ptcuZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.sectorCode ? `S${z.sectorCode} · ` : ""}
                {z.code ? `Zone ${z.code} · ` : ""}
                {z.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {audience === "OFFICER" && (
        <OfficerPicker officers={officers} value={officerId} onChange={setOfficerId} />
      )}

      <div>
        <label className="text-[11px] font-bold text-black/50 block mb-1">Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="e.g. Parade 0600 at Muthurwa"
          className="input text-xs w-full"
        />
      </div>

      <div>
        <label className="text-[11px] font-bold text-black/50 block mb-1">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="Write the order or notice…"
          className="input text-xs w-full resize-y"
        />
      </div>

      <label className="flex items-center gap-2 text-[11px] font-semibold text-black/60">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
        Mark urgent — highlights it on the officer&apos;s screen
      </label>

      <button
        type="button"
        onClick={handleSend}
        disabled={isPending}
        className="btn-primary w-full !py-2.5 text-xs font-bold flex items-center justify-center gap-1.5"
      >
        <Send size={14} strokeWidth={2} />
        {isPending ? "Sending…" : "Send broadcast"}
      </button>
    </div>
  );
}
