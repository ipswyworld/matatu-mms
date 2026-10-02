"use client";

import { useState, useTransition } from "react";
import { Megaphone, Send } from "lucide-react";
import { alertCrewAction } from "@/lib/actions";
import { Matatu } from "@/lib/types";

/**
 * The other direction of the crew portal's "Send Rapid Incident Alert" —
 * an operator pushing a message to their own crew (e.g. a route diversion
 * or "return to depot"), delivered through the same NotificationBell every
 * crew account's session already has open (routes/notifications.py).
 */
export default function AlertCrewForm({ matatus }: { matatus: Matatu[] }) {
  const [message, setMessage] = useState("");
  const [matatuId, setMatatuId] = useState("");
  const [result, setResult] = useState<{ notified?: number; error?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setResult(null);
    startTransition(async () => {
      const res = await alertCrewAction({ message: message.trim(), matatuId: matatuId || undefined });
      setResult(res);
      if (!res.error) setMessage("");
    });
  };

  return (
    <div className="card p-5 space-y-3">
      <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
        <Megaphone size={15} strokeWidth={2} className="text-county-ink/50" />
        Alert Your Crew
      </h3>
      <p className="text-xs text-black/50 -mt-1">
        Send a message to drivers and conductors right now — it shows up on their dashboard immediately.
      </p>
      <form onSubmit={handleSend} className="space-y-2.5">
        <select value={matatuId} onChange={(e) => setMatatuId(e.target.value)} className="input text-xs">
          <option value="">All active crew</option>
          {matatus.map((m) => (
            <option key={m.id} value={m.id}>{m.regNumber} only</option>
          ))}
        </select>
        <textarea
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Diversion via Kenyatta Ave until further notice"
          className="input text-xs"
        />
        <button
          type="submit"
          disabled={isPending || !message.trim()}
          className="btn-primary w-full !py-2 text-xs font-bold flex items-center justify-center gap-1.5"
        >
          <Send size={13} strokeWidth={2} />
          {isPending ? "Sending…" : "Send Alert"}
        </button>
      </form>
      {result?.error && (
        <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2 text-xs font-semibold">
          {result.error}
        </div>
      )}
      {result?.notified !== undefined && !result.error && (
        <div className="bg-county-green/10 text-county-green border border-county-green/30 rounded-lg p-2 text-xs font-semibold">
          Sent to {result.notified} crew member{result.notified === 1 ? "" : "s"}.
        </div>
      )}
    </div>
  );
}
