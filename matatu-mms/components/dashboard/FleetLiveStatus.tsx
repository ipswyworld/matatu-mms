import { Booking, Matatu } from "@/lib/types";
import { LiveVehicleTelemetry } from "@/lib/data";

interface FleetLiveStatusProps {
  matatus: Matatu[];
  telemetry: LiveVehicleTelemetry[];
  bookings: Booking[];
}

/**
 * Admin/Viewer visibility into what Crew can only see for themselves today:
 * is a vehicle's crew actually online (real GPS broadcast, not a guess), and
 * how many seats does it genuinely have occupied right now (real bookings).
 */
export default function FleetLiveStatus({ matatus, telemetry, bookings }: FleetLiveStatusProps) {
  const telemetryByMatatu = new Map(telemetry.map((t) => [t.matatu_id, t]));
  const activeMatatus = matatus.filter((m) => m.status === "ACTIVE");
  const liveCount = activeMatatus.filter((m) => telemetryByMatatu.has(m.id)).length;

  const occupiedSeatsByMatatu = new Map<string, number>();
  bookings
    .filter((b) => b.status === "CONFIRMED")
    .forEach((b) => {
      occupiedSeatsByMatatu.set(b.matatuId, (occupiedSeatsByMatatu.get(b.matatuId) || 0) + b.seatNumbers.length);
    });

  return (
    <div className="rounded-2xl bg-white p-5 md:p-6 shadow-sm ring-1 ring-county-ink/[0.06]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-black text-county-ink text-base tracking-tight">Live fleet status</h3>
          <p className="text-[11px] text-county-ink/50 mt-1">Real GPS broadcast state and seat occupancy, not simulated</p>
        </div>
        <span className="badge bg-county-green/10 text-county-green font-bold">
          {liveCount} of {activeMatatus.length} broadcasting
        </span>
      </div>

      {activeMatatus.length === 0 ? (
        <p className="text-sm text-county-ink/40 py-8 text-center">No active vehicles registered.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>GPS status</th>
                <th>Speed</th>
                <th>Seats occupied</th>
              </tr>
            </thead>
            <tbody>
              {activeMatatus.map((m) => {
                const live = telemetryByMatatu.get(m.id);
                const occupied = occupiedSeatsByMatatu.get(m.id) || 0;
                return (
                  <tr key={m.id}>
                    <td className="font-bold text-county-ink">{m.regNumber}</td>
                    <td>
                      {live ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-county-green">
                          <span className="relative flex h-2 w-2">
                            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-county-green opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-county-green" />
                          </span>
                          Live
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-county-ink/35">Offline</span>
                      )}
                    </td>
                    <td className="text-county-ink/70">{live ? `${Math.round(live.speed)} km/h` : "—"}</td>
                    <td className="text-county-ink/70">
                      {occupied} / {m.capacity}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
