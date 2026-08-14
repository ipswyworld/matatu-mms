"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import GisMap, { NAIROBI_STAGES } from "@/components/GisMap";
import MatatuGlyph from "@/components/MatatuGlyph";
import EmptyState from "@/components/EmptyState";
import PageBanner from "@/components/PageBanner";
import { createBookingAction, getTakenSeatsAction, submitReportAction, updateBookingStatusAction } from "@/lib/actions";
import { Booking, Matatu, Route, Stage } from "@/lib/types";

interface PassengerBookingClientProps {
  routes: Route[];
  matatus: Matatu[];
}

const CAPACITY_LABELS: Record<number, string> = {
  14: "14-Seater Nissan Matatu",
  25: "25-Seater Minibus",
  33: "33-Seater Shuttle",
  45: "45-Seater Coach",
  51: "51-Seater Executive",
  61: "61-Seater City Bus",
};

export default function PassengerBookingClient({ routes, matatus }: PassengerBookingClientProps) {
  const [activeTab, setActiveTab] = useState<"booking" | "feedback">("booking");
  const [selectedStage, setSelectedStage] = useState<Stage>(NAIROBI_STAGES[0]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>("all");
  const [selectedMatatu, setSelectedMatatu] = useState<Matatu | null>(matatus[0] || null);
  const [seatCount, setSeatCount] = useState(1);
  const [takenSeats, setTakenSeats] = useState<number[]>([]);
  const [isPending, startTransition] = useTransition();

  const [phone, setPhone] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);

  const [feedbackMatatuReg, setFeedbackMatatuReg] = useState("");
  const [feedbackType, setFeedbackType] = useState("Overcharging Complaint");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackPhoto, setFeedbackPhoto] = useState<File | null>(null);
  const feedbackPhotoInputRef = useRef<HTMLInputElement>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackReportId, setFeedbackReportId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);

  const filteredMatatus = matatus.filter(
    (m) => selectedRouteId === "all" || m.routeId === selectedRouteId
  );

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
        stageName: selectedStage.name,
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

  const handleSendFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackMessage) return;
    setFeedbackError(null);
    startTransition(async () => {
      const result = await submitReportAction({
        matatuRegNumber: feedbackMatatuReg || undefined,
        category: feedbackType,
        message: feedbackMessage,
        reporterName: passengerName || undefined,
        reporterPhone: phone || undefined,
        photo: feedbackPhoto,
      });
      if (result.error) {
        setFeedbackError(result.error);
        return;
      }
      setFeedbackReportId(result.report?.id || null);
      setFeedbackSubmitted(true);
      setTimeout(() => {
        setFeedbackMessage("");
        setFeedbackMatatuReg("");
        setFeedbackPhoto(null);
        if (feedbackPhotoInputRef.current) feedbackPhotoInputRef.current.value = "";
        setFeedbackSubmitted(false);
      }, 3000);
    });
  };

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Commuter Portal"
        title="Book Your Matatu"
        subtitle="Reserve a seat on a real, live-tracked vehicle, or report overcharging and safety issues directly to County Traffic Enforcement."
        action={
          <>
            <button
              onClick={() => setActiveTab("booking")}
              className={`rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
                activeTab === "booking" ? "bg-county-green text-white" : "bg-white/10 text-white/80 hover:bg-white/15"
              }`}
            >
              Seat Reservation & Live Map
            </button>
            <button
              onClick={() => setActiveTab("feedback")}
              className={`rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
                activeTab === "feedback" ? "bg-county-green text-white" : "bg-white/10 text-white/80 hover:bg-white/15"
              }`}
            >
              Feedback & Reports
            </button>
          </>
        }
      />

      {activeTab === "booking" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-county-green" />
              <span className="text-black/60">Boarding at</span>
              <span className="font-bold text-county-black">{selectedStage.name}</span>
            </div>
            <span className="badge bg-county-green/10 text-county-green font-bold">
              {filteredMatatus.length} active {filteredMatatus.length === 1 ? "vehicle" : "vehicles"} on this corridor
            </span>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <GisMap selectedStageId={selectedStage.id} onSelectStage={(stg) => setSelectedStage(stg)} />

              <div className="card p-4 space-y-4">
                <h3 className="font-bold text-sm text-county-black">Select Boarding Stage & Route</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Boarding Terminus / Stage</label>
                    <select
                      value={selectedStage.id}
                      onChange={(e) => setSelectedStage(NAIROBI_STAGES.find((s) => s.id === e.target.value) || NAIROBI_STAGES[0])}
                      className="input"
                    >
                      {NAIROBI_STAGES.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Route Corridor</label>
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
                </div>
              </div>

              <div className="card p-5 space-y-3">
                <h3 className="font-bold text-sm">Available Matatus En-Route ({filteredMatatus.length})</h3>
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

                          <div className="flex justify-between items-center text-xs mt-3 pt-2 border-t border-black/5">
                            <span className="font-semibold text-black/70">
                              {CAPACITY_LABELS[m.capacity] || `${m.capacity}-Seater Matatu`}
                            </span>
                            <span className="font-bold text-county-green">{m.terminalSegment}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
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
                </div>
              )}

              <div className="card p-5 space-y-4">
                <h3 className="font-bold text-sm text-county-black">How Many Seats?</h3>
                <p className="text-xs text-black/50 -mt-2">No need to pick an exact seat — we'll assign the next available one(s) for you.</p>

                {activeBooking ? (
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
                          className="btn-danger flex-1 text-xs !py-1.5"
                        >
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
                      className="btn-primary w-full !py-2.5 text-sm font-bold"
                    >
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
        </>
      ) : (
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="card p-6 space-y-4">
            <h3 className="text-base font-extrabold text-county-black border-b border-black/10 pb-3">
              Submit Commuter Report or Overcharging Complaint
            </h3>
            <p className="text-xs text-black/60">
              Report fare overcharging beyond published gazetted rates, reckless driving, or unroadworthy vehicles directly to County Traffic Officers.
            </p>

            {feedbackSubmitted ? (
              <div className="bg-county-green/10 text-county-green border border-county-green/30 rounded-xl p-4 text-xs font-bold text-center">
                Report Submitted to County Traffic Enforcement! Incident Log Reference: #{feedbackReportId || "PENDING"}
              </div>
            ) : (
              <form onSubmit={handleSendFeedback} className="space-y-4">
                {feedbackError && (
                  <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2.5 text-xs font-semibold">
                    {feedbackError}
                  </div>
                )}
                <div>
                  <label className="label">Vehicle Plate Number (Optional)</label>
                  <input
                    type="text"
                    value={feedbackMatatuReg}
                    onChange={(e) => setFeedbackMatatuReg(e.target.value)}
                    placeholder="e.g. KDA 112B"
                    className="input"
                  />
                </div>

                <div>
                  <label className="label">Report Category</label>
                  <select
                    value={feedbackType}
                    onChange={(e) => setFeedbackType(e.target.value)}
                    className="input font-semibold"
                  >
                    <option value="Overcharging Complaint">Overcharging Beyond Gazetted Fare</option>
                    <option value="Reckless Driving">Reckless Driving / Speeding</option>
                    <option value="Loud Music / Noise Violation">Loud Music / Noise Violation</option>
                    <option value="Expired Route Badge">Crew Missing Badges / Uniforms</option>
                    <option value="Positive Service Compliment">Commendation / Service Compliment</option>
                  </select>
                </div>

                <div>
                  <label className="label">Complaint Details</label>
                  <textarea
                    rows={4}
                    required
                    value={feedbackMessage}
                    onChange={(e) => setFeedbackMessage(e.target.value)}
                    placeholder="Describe location, conductor behavior, or extra fare demanded..."
                    className="input"
                  />
                </div>

                <div>
                  <label className="label">Photo Evidence (Optional)</label>
                  <input
                    ref={feedbackPhotoInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setFeedbackPhoto(e.target.files?.[0] || null)}
                    className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-black/5 file:px-3 file:py-1.5 file:text-xs file:font-bold"
                  />
                  {feedbackPhoto && (
                    <p className="text-[11px] text-county-green font-semibold mt-1">Attached: {feedbackPhoto.name}</p>
                  )}
                </div>

                <button type="submit" disabled={isPending} className="btn-primary w-full !py-2.5 text-sm font-bold">
                  {isPending ? "Submitting..." : "Submit Official Commuter Report"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
