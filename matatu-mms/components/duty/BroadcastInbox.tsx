"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Radio } from "lucide-react";
import { markBroadcastReadAction } from "@/lib/actions";
import { Broadcast } from "@/lib/types";

/**
 * The officer's orders. Persisted server-side rather than being a live
 * toast, so a broadcast sent while the officer's phone was off is still
 * here when they open the app — see backend/app/routes/broadcasts.py for
 * why that distinction mattered enough to build a table for.
 */
export default function BroadcastInbox({ broadcasts }: { broadcasts: Broadcast[] }) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const markRead = (id: string) => {
    setReadIds((prev) => new Set(prev).add(id));
    startTransition(async () => {
      await markBroadcastReadAction(id);
    });
  };

  const unreadCount = broadcasts.filter((b) => !b.readAt && !readIds.has(b.id)).length;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
          <Radio size={14} strokeWidth={2} className="text-county-ink/50" />
          Orders &amp; notices
        </h3>
        {unreadCount > 0 && (
          <span className="badge bg-county-red/10 text-county-red text-[10px] font-extrabold">
            {unreadCount} unread
          </span>
        )}
      </div>

      {broadcasts.length === 0 ? (
        <p className="text-xs text-black/40 italic">Nothing has been sent to you yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {broadcasts.map((broadcast) => {
            const isRead = Boolean(broadcast.readAt) || readIds.has(broadcast.id);
            const urgent = broadcast.priority === "URGENT";
            return (
              <li
                key={broadcast.id}
                className={`rounded-xl p-3.5 border ${
                  urgent && !isRead
                    ? "border-county-red/30 bg-county-red/[0.06]"
                    : isRead
                      ? "border-black/[0.06] bg-white"
                      : "border-county-green/25 bg-county-green/[0.04]"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {urgent && (
                    <AlertTriangle size={15} strokeWidth={2} className="text-county-red shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${isRead ? "font-semibold text-black/70" : "font-black text-county-black"}`}>
                      {broadcast.subject}
                    </p>
                    <p className="text-[11px] text-black/60 mt-1 whitespace-pre-wrap">{broadcast.body}</p>
                    <p className="text-[10px] text-black/35 mt-2">
                      {broadcast.sentByName ? `${broadcast.sentByName} · ` : ""}
                      {new Date(broadcast.sentAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {broadcast.audienceLabel ? ` · ${broadcast.audienceLabel}` : ""}
                    </p>
                  </div>
                  {!isRead && (
                    <button
                      type="button"
                      onClick={() => markRead(broadcast.id)}
                      disabled={isPending}
                      className="text-[10px] font-bold text-county-green hover:underline shrink-0"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
