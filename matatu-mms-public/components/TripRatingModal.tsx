"use client";

import { useState, useTransition } from "react";
import { Star, X } from "lucide-react";
import { createTripRatingAction } from "@/lib/actions";
import { PendingRating } from "@/lib/types";

/**
 * Shown once per completed, unrated trip — rates the crew (driver/
 * conductor resolved server-side against who was actually assigned to the
 * vehicle at booking time) and the sacco together. Deliberately separate
 * from PassengerFeedbackForm, which is an unrelated enforcement-complaint
 * channel (overcharging, reckless driving), not a satisfaction rating.
 */
export default function TripRatingModal({ pending }: { pending: PendingRating[] }) {
  const [queue, setQueue] = useState(pending);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const current = queue[0];
  if (!current) return null;

  const dismiss = () => {
    setQueue((q) => q.slice(1));
    setRating(0);
    setComment("");
    setError(null);
  };

  const submit = () => {
    if (rating < 1) {
      setError("Pick a star rating first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createTripRatingAction({ bookingId: current.bookingId, rating, comment: comment.trim() || undefined });
      if (result.error) {
        setError(result.error);
        return;
      }
      dismiss();
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-5 space-y-4 relative">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss rating prompt"
          className="absolute top-3 right-3 text-black/30 hover:text-black/60"
        >
          <X size={16} strokeWidth={2} />
        </button>

        <div>
          <h3 className="font-bold text-sm text-county-black">How was your trip?</h3>
          <p className="text-xs text-black/50 mt-0.5">
            {current.regNumber} · {current.routeName}
          </p>
        </div>

        <div className="flex items-center justify-center gap-1.5 py-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
              className="p-0.5"
            >
              <Star
                size={28}
                strokeWidth={1.5}
                className={n <= rating ? "text-county-yellow" : "text-black/15"}
                fill={n <= rating ? "currentColor" : "none"}
              />
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anything else? (optional)"
          rows={2}
          className="input text-xs w-full resize-none"
        />

        {error && <p className="text-xs font-semibold text-county-red">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={dismiss} className="btn-secondary flex-1 text-xs !py-2">
            Skip
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="btn-primary flex-1 text-xs !py-2"
          >
            {isPending ? "Submitting…" : "Submit Rating"}
          </button>
        </div>
      </div>
    </div>
  );
}
