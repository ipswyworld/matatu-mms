"use client";

import { useState } from "react";
import { submitPublicCommentAction } from "@/lib/actions";

export default function LeaveCommentSection() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus("sending");
    const result = await submitPublicCommentAction({ message: message.trim(), name: name.trim() || undefined });
    if (result.ok) {
      setStatus("sent");
      setMessage("");
      setName("");
    } else {
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-bold text-white/60 hover:text-county-yellow underline underline-offset-4 decoration-white/20 hover:decoration-county-yellow transition-colors"
      >
        Have a thought on this system? Leave a comment →
      </button>
    );
  }

  if (status === "sent") {
    return (
      <div className="text-xs font-semibold text-county-yellow">
        Thanks — your comment has reached the county transport team.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm space-y-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Tell us what's working, or what isn't…"
        rows={2}
        required
        className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-county-yellow/60 resize-none"
      />
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="flex-1 rounded-lg bg-white/10 border border-white/15 px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-county-yellow/60"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-lg bg-county-yellow text-county-ink text-xs font-extrabold px-3 py-1.5 hover:brightness-95 transition disabled:opacity-60"
        >
          {status === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
      {status === "error" && (
        <p className="text-[11px] text-county-yellow/90">Couldn't send that — please try again.</p>
      )}
    </form>
  );
}
