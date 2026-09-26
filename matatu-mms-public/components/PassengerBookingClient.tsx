"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Ticket, MapPin, Bus, Armchair, XCircle, Navigation, LocateFixed } from "lucide-react";
import GisMap from "@/components/GisMap";
import TripPlanner from "@/components/TripPlanner";
import DestinationGuidance from "@/components/DestinationGuidance";
import { StageOption } from "@/components/StageSearchField";
import MatatuGlyph from "@/components/MatatuGlyph";
import EmptyState from "@/components/EmptyState";
import { createBookingAction, getTakenSeatsAction, updateBookingStatusAction } from "@/lib/actions";
import { Booking, Matatu, Route, Sacco } from "@/lib/types";
import { useLiveVehicles } from "@/lib/useLiveVehicles";
import { usePassengerLocation, haversineMeters, formatDistance, formatEta } from "@/lib/geo";

interface PassengerBookingClientProps {
  routes: Route[];
  matatus: Matatu[];
  saccos: Sacco[];
}

const CAPACITY_LABELS: Record<number, string> = {
  14: "14-Seater Nissan Matatu",
  25: "25-Seater Minibus",
  33: "33-Seater Shuttle",
  45: "45-Seater Coach",
  51: "51-Seater Executive",
  61: "61-Seater City Bus",
};

export default function PassengerBookingClient({ routes, matatus, saccos }: PassengerBookingClientProps) {
  const [viewMode, setViewMode] = useState<"plan" | "browse">("plan");
  const [boardingStageName, setBoardingStageName] = useState<string | null>(null);
  const [fromStage, setFromStage] = useState<StageOption | null>(null);
  const [toStage, setToStage] = useState<StageOption | null>(null);
  const [guidanceStage, setGuidanceStage] = useState<StageOption | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string>("all");
  const [selectedMatatu, setSelectedMatatu] = useState<Matatu | null>(null);
  const [seatCount, setSeatCount] = useState(1);
  const [takenSeats, setTakenSeats] = useState<number[]>([]);
  const [isPending, startTransition] = useTransition();
  const bookingPanelRef = useRef<HTMLDivElement>(null);

  const [phone, setPhone] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  const saccoById = useMemo(() => new Map(saccos.map((s) => [s.id, s])), [saccos]);
  const matatuById = useMemo(() => new Map(matatus.map((m) => [m.id, m])), [matatus]);

  const liveVehicles = useLiveVehicles();
  const { location: myLocation, status: geoStatus, request: requestLocation } = usePassengerLocation();

  const distanceTo = (matatuId: string): { meters: number; etaLabel: string; speed: number } | null => {
    const live = liveVehicles[matatuId];
    if (!live || !myLocation) return null;
    const meters = haversineMeters(myLocation.lat, myLocation.lng, live.lat, live.lng);
    return { meters, etaLabel: formatEta(meters, live.speed), speed: live.speed };
  };

  const handlePickMatatuFromPlanner = (matatuId: string) => {
    const matatu = matatuById.get(matatuId);
    if (!matatu) return;
    setSelectedMatatu(matatu);
    setSeatCount(1);
    setActiveBooking(null);
    bookingPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const filteredMatatus = matatus.filter((m) => selectedRouteId === "all" || m.routeId === selectedRouteId);

  // Fetch real seat occupancy whenever the selected vehicle changes
  useEffect(() => {
    if (!selectedMatatu) return;
    getTakenSeatsAction(selectedMatatu.id).then(setTakenSeats);
    setSeatCount(1);
  }, [selectedMatatu]);

  const freeSeatsCount = selectedMatatu ? selectedMatatu.capacity - takenSeats.length : 0;
  const selectedRouteFare = selectedMatatu ? routeById.get(selectedMatatu.routeId)?.fareKes || 0 : 0;
  const totalFare = selectedRouteFare * seatCount;

  const handleBookTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (seatCount < 1 || !selectedMatatu) return;

    // No exact-seat picking — the county assigns the next free seat numbers
    // automatically. The passenger just says how many seats they need.
    const takenSet = new Set(takenSeats);
    const assignedSeats: number[] = [];
    for (let seatId = 1; seatId <= selectedMatatu.capacity && assignedSeats.length < seatCount; seatId++) {
      if (!takenSet.has(seatId)) assignedSeats.push(seatId);
    }
    if (assignedSeats.length < seatCount) {
      setBookingError(`Only ${assignedSeats.length} seat(s) left on this vehicle.`);
      return;
    }

    setBookingError(null);
    startTransition(async () => {
      const result = await createBookingAction({
        matatuId: selectedMatatu.id,
        routeId: selectedMatatu.routeId,
        passengerName: passengerName || "Commuter",
        phone: phone || "0712345678",
        stageName: boardingStageName || selectedMatatu.terminalSegment,
        seatNumbers: assignedSeats,
      });

      if (result.error) {
        setBookingError(result.error);
        return;
      }
      if (result.booking) {
        setActiveBooking(result.booking);
        setTakenSeats((prev) => [...prev, ...assignedSeats]);
      }
    });
  };

  const handleCancelBooking = () => {
    if (!activeBooking) return;
    setBookingError(null);
    startTransition(async () => {
      const result = await updateBookingStatusAction(activeBooking.id, "CANCELLED");
      if (result.error) {
        setBookingError(result.error);
        return;
      }
      setTakenSeats((prev) => prev.filter((seatId) => !activeBooking.seatNumbers.includes(seatId)));
      setActiveBooking(null);
      setSeatCount(1);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode("plan")}
            className={`badge font-bold ${viewMode === "plan" ? "bg-county-green text-white" : "bg-black/5 text-county-black hover:bg-black/10"}`}
          >
            Plan a Trip
          </button>
          <button
            type="button"
            onClick={() => setViewMode("browse")}
            className={`badge font-bold ${viewMode === "browse" ? "bg-county-green text-white" : "bg-black/5 text-county-black hover:bg-black/10"}`}
          >
            Browse by Route
          </button>
        </div>
        <div className="flex items-center gap-2">
          {geoStatus === "granted" ? (
            <span className="badge bg-county-blue/10 text-county-blue font-bold flex items-center gap-1">
              <LocateFixed size={11} strokeWidth={2.5} />
              Showing live distance
            </span>
          ) : (
            <button
              onClick={requestLocation}
              disabled={geoStatus === "locating" || geoStatus === "unsupported"}
              className="badge bg-black/5 text-county-black font-bold flex items-center gap-1 hover:bg-black/10 transition-colors disabled:opacity-50"
            >
              <Navigation size={11} strokeWidth={2.5} />
              {geoStatus === "locating"
                ? "Locating…"
                : geoStatus === "denied"
                ? "Location blocked"
                : geoStatus === "unsupported"
                ? "Location unavailable"
                : "See distance to matatus"}
            </button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {viewMode === "plan" ? (
            <>
              {/* Map + trip search as one instrument (Citymapper/Uber
                  register): dark map on top, the connected From/To search
                  docked flush beneath it, sharing one outer rounded/shadow
                  boundary instead of two stacked cards. */}
              <div className="rounded-2xl overflow-hidden bg-county-black shadow-2xl">
                <GisMap embedded fromStage={fromStage} toStage={toStage} focusedVehicleId={selectedMatatu?.id ?? null} />
                <TripPlanner
                  embedded
                  onSelectMatatu={handlePickMatatuFromPlanner}
                  onFromChange={(stage) => {
                    setBoardingStageName(stage.name);
                    setFromStage(stage);
                  }}
                  onToChange={setToStage}
                  onStartGuidance={setGuidanceStage}
                  guidanceActive={Boolean(guidanceStage)}
                />
              </div>
              <DestinationGuidance externalStart={guidanceStage} />
            </>
          ) : (
            <>
              <GisMap fromStage={fromStage} toStage={toStage} focusedVehicleId={selectedMatatu?.id ?? null} />
              <div className="card p-4 space-y-4">
              <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
                <MapPin size={15} strokeWidth={2} className="text-county-ink/50" />
                Route Corridor
              </h3>
              <select
                value={selectedRouteId}
                onChange={(e) => setSelectedRouteId(e.target.value)}
                className="input"
              >
                <option value="all">All Corridors & Routes</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>Route {r.code} - {r.name}</option>
                ))}
              </select>
              </div>
            </>
          )}

          <div className="card p-5 space-y-3">
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <Bus size={15} strokeWidth={2} className="text-county-ink/50" />
              Available Matatus En-Route ({filteredMatatus.length})
            </h3>
            {filteredMatatus.length === 0 ? (
              <EmptyState
                title="No active vehicles on this route right now"
                hint="Try a different route corridor, or check back shortly — the fleet updates in real time."
              />
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {filteredMatatus.map((m) => {
                  const route = routeById.get(m.routeId);
                  const isSelected = selectedMatatu?.id === m.id;
                  const distance = distanceTo(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => {
                        setSelectedMatatu(m);
                        setSeatCount(1);
                        setActiveBooking(null);
                      }}
                      className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? "bg-county-green/10 border-county-green ring-2 ring-county-green/30 shadow-md"
                          : "bg-white border-black/10 hover:border-county-green/50"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${
                              isSelected ? "bg-county-green text-white" : "bg-county-black/5 text-county-black/60"
                            }`}
                          >
                            <MatatuGlyph size={22} />
                          </div>
                          <div>
                            <div className="font-extrabold text-base text-county-black">{m.regNumber}</div>
                            <div className="text-xs text-black/50">Route {route?.code} · {route?.name}</div>
                          </div>
                        </div>
                        <span className="badge bg-black/5 text-county-black font-bold shrink-0">
                          KES {route?.fareKes ?? "—"} / seat
                        </span>
                      </div>

                      <div className="text-[11px] font-bold text-black/40 mt-2">
                        {saccoById.get(m.saccoId)?.name || "Operator"}
                      </div>

                      <div className="flex justify-between items-center text-xs mt-3 pt-2 border-t border-black/5">
                        <span className="font-semibold text-black/70">
                          {CAPACITY_LABELS[m.capacity] || `${m.capacity}-Seater Matatu`}
                        </span>
                        <span className="font-bold text-county-green">{m.terminalSegment}</span>
                      </div>
                      {distance && (
                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-black/5 text-xs">
                          <Navigation size={11} strokeWidth={2.5} className="text-county-blue shrink-0" />
                          <span className="font-extrabold text-county-blue">{formatDistance(distance.meters)} away</span>
                          <span className="text-black/40">·</span>
                          <span className="font-semibold text-black/60">{distance.etaLabel}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6" ref={bookingPanelRef}>
          {selectedMatatu && (
            <div className="bg-county-black rounded-2xl p-5 text-white shadow-xl border border-white/10 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white/60 uppercase tracking-wider">{selectedMatatu.regNumber}</span>
                <span className="text-xs font-bold text-county-yellow">{freeSeatsCount} of {selectedMatatu.capacity} seats free</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-county-green rounded-full transition-all"
                  style={{ width: `${selectedMatatu.capacity ? (freeSeatsCount / selectedMatatu.capacity) * 100 : 0}%` }}
                />
              </div>
              {(() => {
                const distance = distanceTo(selectedMatatu.id);
                if (distance) {
                  return (
                    <div className="flex items-center gap-1.5 pt-2 mt-1 border-t border-white/10">
                      <Navigation size={13} strokeWidth={2.5} className="text-county-blue shrink-0" />
                      <span className="text-sm font-extrabold">{formatDistance(distance.meters)} away</span>
                      <span className="text-white/40">·</span>
                      <span className="text-xs font-semibold text-white/70">{distance.etaLabel}</span>
                    </div>
                  );
                }
                if (!liveVehicles[selectedMatatu.id]) {
                  return <p className="text-[11px] text-white/40 pt-2 mt-1 border-t border-white/10">Not broadcasting GPS right now.</p>;
                }
                return (
                  <button
                    onClick={requestLocation}
                    className="text-[11px] font-bold text-county-blue pt-2 mt-1 border-t border-white/10 flex items-center gap-1 hover:text-county-blue/80"
                  >
                    <Navigation size={11} strokeWidth={2.5} />
                    Enable location to see distance
                  </button>
                );
              })()}
            </div>
          )}

          <div className={selectedMatatu ? "card p-5 space-y-4" : "p-5 space-y-4 rounded-2xl bg-black/[0.02]"}>
            <h3 className={`font-bold text-sm flex items-center gap-1.5 ${selectedMatatu ? "text-county-black" : "text-county-black/50"}`}>
              <Armchair size={15} strokeWidth={2} className="text-county-ink/40" />
              How Many Seats?
            </h3>
            {selectedMatatu && (
              <p className="text-xs text-black/50 -mt-2">No need to pick an exact seat — we'll assign the next available one(s) for you.</p>
            )}

            {!selectedMatatu ? (
              <EmptyState
                title="Pick a matatu to get started"
                hint="Plan a trip above, or browse by route, then choose a vehicle."
              />
            ) : activeBooking ? (
              <div className="bg-county-green/10 border border-county-green/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-county-green/20 pb-2">
                  <span className="text-xs font-bold text-county-green uppercase">Group Boarding Pass</span>
                  <span className="font-mono text-xs font-extrabold">{activeBooking.id}</span>
                </div>
                <div className="text-sm space-y-1">
                  <div className="font-extrabold text-county-black">{activeBooking.regNumber}</div>
                  <div className="text-xs text-black/60">{activeBooking.routeName}</div>
                  <div className="text-xs text-black/60">Boarding Stage: <span className="font-semibold text-black">{activeBooking.stageName}</span></div>
                  <div className="text-xs text-black/60">
                    Reserved Seats ({activeBooking.seatNumbers.length}):{" "}
                    <span className="font-bold text-county-blue">
                      {activeBooking.seatNumbers.map((id) => `Seat #${id}`).join(", ")}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-county-green mt-2 p-2.5 bg-county-green/10 rounded-lg border border-county-green/20">
                    Payment Note: Pay cumulative total KES {activeBooking.fareKes} directly to the Conductor or Driver upon boarding.
                  </div>
                </div>

                <div className="pt-2 border-t border-county-green/20 text-center">
                  <div className="font-mono text-[10px] tracking-widest text-black/50 mb-1">||||| | |||| ||| |||| | |||||</div>
                  {bookingError && (
                    <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2 text-xs font-semibold mb-2">
                      {bookingError}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        setActiveBooking(null);
                        setSeatCount(1);
                      }}
                      className="btn-secondary flex-1 text-xs !py-1.5"
                    >
                      Reserve More Seats
                    </button>
                    <button
                      onClick={handleCancelBooking}
                      disabled={isPending}
                      className="btn-danger flex-1 text-xs !py-1.5 flex items-center justify-center gap-1"
                    >
                      <XCircle size={13} strokeWidth={2} />
                      {isPending ? "Cancelling..." : "Cancel Booking"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleBookTicket} className="space-y-3">
                {bookingError && (
                  <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2.5 text-xs font-semibold">
                    {bookingError}
                  </div>
                )}

                <div className="flex items-center justify-between bg-black/5 rounded-lg p-2.5 border border-black/5">
                  <span className="text-xs font-bold text-black/60">Number of seats</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSeatCount((n) => Math.max(1, n - 1))}
                      className="h-8 w-8 rounded-lg bg-white border border-black/10 font-extrabold text-county-black hover:bg-black/5"
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-extrabold text-county-black">{seatCount}</span>
                    <button
                      type="button"
                      onClick={() => setSeatCount((n) => Math.min(freeSeatsCount || 1, n + 1))}
                      className="h-8 w-8 rounded-lg bg-white border border-black/10 font-extrabold text-county-black hover:bg-black/5"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label">Passenger / Group Lead Name</label>
                  <input
                    type="text"
                    required
                    value={passengerName}
                    onChange={(e) => setPassengerName(e.target.value)}
                    placeholder="e.g. John Kamau"
                    className="input"
                  />
                </div>

                <div>
                  <label className="label">Contact Phone Number</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0712345678"
                    className="input"
                  />
                </div>

                <div className="bg-black/5 p-3 rounded-lg text-xs space-y-1.5 border border-black/5">
                  <div className="flex justify-between border-t border-black/5 pt-1.5 first:border-0 first:pt-0">
                    <span className="text-black/60">Total Fare ({seatCount} seat{seatCount !== 1 ? "s" : ""}):</span>
                    <span className="font-extrabold text-county-black">KES {totalFare}</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={freeSeatsCount === 0 || isPending || !selectedMatatu}
                  className="btn-primary w-full !py-2.5 text-sm font-bold flex items-center justify-center gap-2"
                >
                  <Ticket size={16} strokeWidth={2} />
                  {isPending
                    ? "Issuing Boarding Pass..."
                    : freeSeatsCount === 0
                    ? "This vehicle is full"
                    : `Confirm ${seatCount} Seat${seatCount !== 1 ? "s" : ""} & Get Boarding Pass`}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
