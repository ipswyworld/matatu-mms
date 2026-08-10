import { Booking } from "@/lib/types";

interface BookingsPanelProps {
  bookings: Booking[];
}

const STATUS_STYLES: Record<Booking["status"], string> = {
  CONFIRMED: "bg-county-green/10 text-county-green",
  USED: "bg-county-blue/10 text-county-blue",
  CANCELLED: "bg-county-ink/10 text-county-ink/50",
};

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Admin/Viewer visibility into commuter booking activity — previously
 * invisible outside the Passenger Portal itself.
 */
export default function BookingsPanel({ bookings }: BookingsPanelProps) {
  const sorted = bookings
    .slice()
    .sort((a, b) => new Date(b.bookedAt).getTime() - new Date(a.bookedAt).getTime());

  const today = new Date().toDateString();
  const bookedToday = bookings.filter((b) => new Date(b.bookedAt).toDateString() === today);
  const activeSeats = bookings
    .filter((b) => b.status === "CONFIRMED")
    .reduce((sum, b) => sum + b.seatNumbers.length, 0);
  const revenueToday = bookedToday.reduce((sum, b) => sum + b.fareKes, 0);

  return (
    <div className="rounded-2xl bg-white p-5 md:p-6 shadow-sm ring-1 ring-county-ink/[0.06] flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">Commuter bookings</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">Real-time passenger booking activity across the fleet</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-county-green bg-county-green/10 px-2.5 py-1 rounded-full">
          Live
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="rounded-xl bg-county-cream/70 p-3">
          <div className="text-2xl font-black text-county-ink tabular-nums">{bookedToday.length}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-county-ink/50 mt-0.5">Booked today</div>
        </div>
        <div className="rounded-xl bg-county-cream/70 p-3">
          <div className="text-2xl font-black text-county-ink tabular-nums">{activeSeats}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-county-ink/50 mt-0.5">Seats occupied</div>
        </div>
        <div className="rounded-xl bg-county-cream/70 p-3">
          <div className="text-2xl font-black text-county-ink tabular-nums">KES {(revenueToday / 1000).toFixed(1)}k</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-county-ink/50 mt-0.5">Fares today</div>
        </div>
      </div>

      <ul className="mt-4 space-y-2.5 flex-1 max-h-[280px] overflow-y-auto pr-1">
        {sorted.length === 0 ? (
          <li className="text-sm text-county-ink/40 py-8 text-center">No bookings recorded yet.</li>
        ) : (
          sorted.slice(0, 8).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 text-sm border-b border-county-ink/[0.05] pb-2.5 last:border-0">
              <div className="min-w-0">
                <div className="font-semibold text-county-ink text-[13px] truncate">
                  {b.passengerName} · {b.regNumber || "—"}
                </div>
                <div className="text-xs text-county-ink/50">
                  Seat{b.seatNumbers.length > 1 ? "s" : ""} {b.seatNumbers.join(", ")} · KES {b.fareKes} · {timeAgo(b.bookedAt)}
                </div>
              </div>
              <span className={`badge shrink-0 ${STATUS_STYLES[b.status]}`}>{b.status}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
