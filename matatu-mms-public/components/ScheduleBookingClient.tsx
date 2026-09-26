"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Loader2, XCircle, Repeat, Share2 } from "lucide-react";
import StageSearchField, { StageOption } from "@/components/StageSearchField";
import EmptyState from "@/components/EmptyState";
import { cancelScheduledBookingAction, createScheduledBookingAction } from "@/lib/actions";
import { Route, ScheduledBooking, ScheduledBookingStatus } from "@/lib/types";

const STATUS_STYLE: Record<ScheduledBookingStatus, string> = {
  PENDING: "bg-black/5 text-county-black/60",
  CONFIRMED: "bg-county-green/10 text-county-green",
  BOARDED: "bg-county-blue/10 text-county-blue",
  NO_SHOW: "bg-county-red/10 text-county-red",
  CANCELLED: "bg-black/5 text-county-black/40",
  REASSIGNED: "bg-county-yellow/10 text-county-black/70",
};

/**
 * Swvl-style advance booking: separate from PassengerBookingClient's
 * instant "board a matatu now" flow, deliberately — a scheduled trip has a
 * genuinely different lifecycle (PENDING/CONFIRMED/BOARDED/NO_SHOW/
 * CANCELLED/REASSIGNED, backend/app/models.py's ScheduledBooking), not a
 * mode toggle bolted onto the instant-booking component. Reminders,
 * auto-confirm, and (later) no-show release all happen server-side via
 * app/scheduled_booking_scheduler.py's cron — this component only ever
 * creates/lists/cancels.
 */
export default function ScheduleBookingClient({
  routes,
  initialScheduled,
}: {
  routes: Route[];
  initialScheduled: ScheduledBooking[];
}) {
  const [scheduled, setScheduled] = useState(initialScheduled);
  const [isPending, startTransition] = useTransition();

  const [routeId, setRouteId] = useState(routes[0]?.id || "");
  const [origin, setOrigin] = useState<StageOption | null>(null);
  const [destination, setDestination] = useState<StageOption | null>(null);
  const [departure, setDeparture] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [phone, setPhone] = useState("");
  const [seatCount, setSeatCount] = useState(1);
  const [accessibilityFlag, setAccessibilityFlag] = useState(false);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(4);
  const [trustedContactPhone, setTrustedContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastShareToken, setLastShareToken] = useState<string | null>(null);

  const minDeparture = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!routeId || !origin || !departure) {
      setError("Pick a route, a boarding stage, and a departure time.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createScheduledBookingAction({
        routeId,
        originStageId: origin.id,
        destinationStageId: destination?.id,
        scheduledDeparture: new Date(departure).toISOString(),
        passengerName: passengerName || "Commuter",
        phone: phone || "0712345678",
        seatNumbers: Array.from({ length: seatCount }, (_, i) => i + 1),
        accessibilityFlag,
        trustedContactPhone: trustedContactPhone.trim() || undefined,
        repeatWeeks: repeatWeekly ? repeatWeeks : undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.scheduledBooking) {
        setScheduled((prev) => [result.scheduledBooking!, ...prev]);
        setOrigin(null);
        setDestination(null);
        setDeparture("");
        setSeatCount(1);
        setAccessibilityFlag(false);
        setRepeatWeekly(false);
        setRepeatWeeks(4);
        setTrustedContactPhone("");
        setLastShareToken(result.scheduledBooking.shareToken || null);
      }
    });
  };

  const handleCancel = (id: string) => {
    startTransition(async () => {
      const result = await cancelScheduledBookingAction(id);
      if (!result.error) {
        setScheduled((prev) => prev.map((s) => (s.id === id ? { ...s, status: "CANCELLED" } : s)));
      }
    });
  };

  const cancellable = (s: ScheduledBookingStatus) => s === "PENDING" || s === "CONFIRMED";

  return (
    <div className="card p-4 space-y-4">
      <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
        <CalendarClock size={15} strokeWidth={2} className="text-county-ink/50" />
        Schedule a Trip in Advance
      </h3>
      <p className="text-xs text-black/50 -mt-2">
        Book a seat for any future time — minutes, hours, or days out — instead of only right now.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2.5 text-xs font-semibold">
            {error}
          </div>
        )}

        <div>
          <label className="label">Route</label>
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="input">
            {routes.map((r) => (
              <option key={r.id} value={r.id}>Route {r.code} - {r.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Boarding Stage</label>
          <StageSearchField placeholder="Where you'll board…" onSelect={setOrigin} />
          {origin && <p className="text-xs font-semibold text-county-green mt-1">{origin.name}</p>}
        </div>

        <div>
          <label className="label">Destination (optional)</label>
          <StageSearchField placeholder="Where you're going…" onSelect={setDestination} originStageId={origin?.id} />
          {destination && <p className="text-xs font-semibold text-county-green mt-1">{destination.name}</p>}
        </div>

        <div>
          <label className="label">Departure Date &amp; Time</label>
          <input
            type="datetime-local"
            required
            min={minDeparture}
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            className="input"
          />
        </div>

        <div className="flex items-center justify-between bg-black/5 rounded-lg p-2.5 border border-black/5">
          <span className="text-xs font-bold text-black/60">Number of seats</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setSeatCount((n) => Math.max(1, n - 1))} className="h-8 w-8 rounded-lg bg-white border border-black/10 font-extrabold text-county-black hover:bg-black/5">−</button>
            <span className="w-6 text-center font-extrabold text-county-black">{seatCount}</span>
            <button type="button" onClick={() => setSeatCount((n) => Math.min(10, n + 1))} className="h-8 w-8 rounded-lg bg-white border border-black/10 font-extrabold text-county-black hover:bg-black/5">+</button>
          </div>
        </div>

        <div>
          <label className="label">Passenger / Group Lead Name</label>
          <input type="text" value={passengerName} onChange={(e) => setPassengerName(e.target.value)} placeholder="e.g. John Kamau" className="input" />
        </div>

        <div>
          <label className="label">Contact Phone Number</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" className="input" />
        </div>

        <label className="flex items-center gap-2.5 text-xs font-semibold text-county-black/70 cursor-pointer">
          <input
            type="checkbox"
            checked={accessibilityFlag}
            onChange={(e) => setAccessibilityFlag(e.target.checked)}
            className="h-4 w-4 rounded border-black/20 text-county-green focus:ring-county-green/30"
          />
          I need a wheelchair-accessible or priority seat
        </label>

        <div>
          <label className="label">Share live trip with a trusted contact (optional)</label>
          <input
            type="tel"
            value={trustedContactPhone}
            onChange={(e) => setTrustedContactPhone(e.target.value)}
            placeholder="Their phone number"
            className="input"
          />
          <p className="text-[11px] text-black/40 mt-1">
            We'll give you a link you can send them — no account needed on their end.
          </p>
        </div>

        <div className="bg-black/5 rounded-lg p-2.5 border border-black/5 space-y-2">
          <label className="flex items-center gap-2.5 text-xs font-semibold text-county-black/70 cursor-pointer">
            <input
              type="checkbox"
              checked={repeatWeekly}
              onChange={(e) => setRepeatWeekly(e.target.checked)}
              className="h-4 w-4 rounded border-black/20 text-county-green focus:ring-county-green/30"
            />
            <Repeat size={13} strokeWidth={2.5} className="text-county-ink/50" />
            Repeat this trip weekly
          </label>
          {repeatWeekly && (
            <div className="flex items-center justify-between pl-6">
              <span className="text-[11px] text-black/50">For how many weeks</span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setRepeatWeeks((n) => Math.max(1, n - 1))} className="h-7 w-7 rounded-lg bg-white border border-black/10 font-extrabold text-county-black hover:bg-black/5">−</button>
                <span className="w-6 text-center font-extrabold text-county-black text-sm">{repeatWeeks}</span>
                <button type="button" onClick={() => setRepeatWeeks((n) => Math.min(12, n + 1))} className="h-7 w-7 rounded-lg bg-white border border-black/10 font-extrabold text-county-black hover:bg-black/5">+</button>
              </div>
            </div>
          )}
        </div>

        <button type="submit" disabled={isPending} className="btn-primary w-full !py-2.5 text-sm font-bold flex items-center justify-center gap-2">
          {isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} strokeWidth={2} />}
          {isPending ? "Scheduling…" : "Schedule This Trip"}
        </button>
      </form>

      {lastShareToken && (
        <div className="bg-county-blue/10 border border-county-blue/20 rounded-lg p-3 flex items-start gap-2.5">
          <Share2 size={15} strokeWidth={2} className="text-county-blue mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-county-black">Share link ready</p>
            <p className="text-[11px] text-black/50 break-all mt-0.5">
              {typeof window !== "undefined" ? `${window.location.origin}/share/${lastShareToken}` : `/share/${lastShareToken}`}
            </p>
          </div>
          <button type="button" onClick={() => setLastShareToken(null)} className="text-county-black/30 hover:text-county-black/60 text-xs ml-auto shrink-0">✕</button>
        </div>
      )}

      <div className="pt-3 border-t border-black/5 space-y-2">
        <h4 className="font-bold text-xs text-county-black/50 uppercase tracking-wide">Your Upcoming Scheduled Trips</h4>
        {scheduled.length === 0 ? (
          <EmptyState title="No scheduled trips yet" hint="Trips you schedule above will show up here." />
        ) : (
          scheduled.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-black/10 bg-white">
              <div className="min-w-0">
                <div className="text-sm font-bold text-county-black">
                  {s.routeName ? `Route ${s.routeCode} - ${s.routeName}` : s.routeId}
                </div>
                <div className="text-[11px] text-black/50">
                  {s.originStageName || "Boarding stage"}
                  {s.destinationStageName ? ` → ${s.destinationStageName}` : ""}
                </div>
                <div className="text-[11px] text-black/50">{new Date(s.scheduledDeparture).toLocaleString()}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`badge font-bold ${STATUS_STYLE[s.status]}`}>{s.status}</span>
                {cancellable(s.status) && (
                  <button
                    type="button"
                    onClick={() => handleCancel(s.id)}
                    disabled={isPending}
                    aria-label="Cancel scheduled trip"
                    className="text-county-black/40 hover:text-county-red"
                  >
                    <XCircle size={16} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
