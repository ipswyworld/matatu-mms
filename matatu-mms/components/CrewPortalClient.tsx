"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import SeatMap from "@/components/SeatMap";
import StatCard from "@/components/StatCard";
import LiveIndicator from "@/components/LiveIndicator";
import EmptyState from "@/components/EmptyState";
import PageBanner from "@/components/PageBanner";
import {
  createBookingAction,
  getBookingByIdAction,
  getBookingsForMatatuAction,
  logCrewIncidentAction,
  updateBookingStatusAction,
} from "@/lib/actions";
import { Booking, Matatu, Route, Seat } from "@/lib/types";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";

interface CrewPortalClientProps {
  matatus: Matatu[];
  routes: Route[];
  token: string;
}

export default function CrewPortalClient({ matatus, routes, token }: CrewPortalClientProps) {
  const [selectedMatatu, setSelectedMatatu] = useState<Matatu | null>(matatus[0] || null);
  const [isBroadcastingGps, setIsBroadcastingGps] = useState(true);
  const [gpsSource, setGpsSource] = useState<"device" | "simulated" | "idle">("idle");

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isPending, startTransition] = useTransition();

  const [ticketSearch, setTicketSearch] = useState("");
  const [scannedTicket, setScannedTicket] = useState<Booking | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);

  const [incidentLocation, setIncidentLocation] = useState("");
  const [incidentReport, setIncidentReport] = useState("");
  const [incidentSent, setIncidentSent] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);

  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);

  const refreshBookings = () => {
    if (!selectedMatatu) return;
    getBookingsForMatatuAction(selectedMatatu.id).then(setBookings);
  };

  useEffect(() => {
    refreshBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMatatu]);

  const takenSeatMap = useMemo(() => {
    const map = new Map<number, Booking>();
    bookings
      .filter((b) => b.status === "CONFIRMED")
      .forEach((b) => b.seatNumbers.forEach((seatId) => map.set(seatId, b)));
    return map;
  }, [bookings]);

  const currentSeats: Seat[] = selectedMatatu
    ? Array.from({ length: selectedMatatu.capacity }, (_, i) => {
        const id = i + 1;
        const route = routeById.get(selectedMatatu.routeId);
        return {
          id,
          label: `S${id}`,
          isOccupied: takenSeatMap.has(id),
          fareKes: route?.fareKes || 0,
        };
      })
    : [];

  const fullSeatsCount = currentSeats.filter((s) => s.isOccupied).length;
  const emptySeatsCount = selectedMatatu ? selectedMatatu.capacity - fullSeatsCount : 0;
  const totalCollectedKes = bookings
    .filter((b) => b.status === "CONFIRMED" || b.status === "USED")
    .reduce((sum, b) => sum + b.fareKes, 0);

  // Tap a seat: empty seat -> record a cash walk-in booking; occupied seat -> cancel (passenger alighted / correction)
  const handleToggleSeat = (seatId: number) => {
    if (!selectedMatatu || isPending) return;
    const route = routeById.get(selectedMatatu.routeId);
    const existingBooking = takenSeatMap.get(seatId);

    startTransition(async () => {
      if (existingBooking) {
        await updateBookingStatusAction(existingBooking.id, "CANCELLED");
      } else {
        await createBookingAction({
          matatuId: selectedMatatu.id,
          routeId: selectedMatatu.routeId,
          passengerName: "Walk-in Passenger (Cash)",
          phone: "N/A",
          stageName: selectedMatatu.terminalSegment,
          seatNumbers: [seatId],
        });
      }
      refreshBookings();
    });
  };

  // Stream live GPS to the passenger map: real device location when granted, simulated jitter as fallback
  useEffect(() => {
    if (!isBroadcastingGps || !selectedMatatu) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let watchId: number | null = null;
    let simInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let attempt = 0;

    const routeCode = routeById.get(selectedMatatu.routeId)?.code || "N/A";

    const send = (lat: number, lng: number, bearing: number, speed: number) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            matatu_id: selectedMatatu.id,
            reg_number: selectedMatatu.regNumber,
            route_code: routeCode,
            lat,
            lng,
            bearing,
            speed,
          })
        );
      }
    };

    const startSimulatedMovement = () => {
      setGpsSource("simulated");
      simInterval = setInterval(() => {
        send(
          -1.2864 + Math.sin(Date.now() / 2000) * 0.005,
          36.8228 + Math.cos(Date.now() / 2000) * 0.005,
          Math.floor((Date.now() / 100) % 360),
          45 + Math.floor(Math.sin(Date.now() / 1000) * 10)
        );
      }, 2000);
    };

    const startDeviceGeolocation = () => {
      if (!("geolocation" in navigator)) {
        startSimulatedMovement();
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsSource("device");
          send(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.heading || 0,
            Math.round((pos.coords.speed || 0) * 3.6)
          );
        },
        () => startSimulatedMovement(),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
      );
    };

    const connect = () => {
      if (cancelled || !token) return;
      ws = new WebSocket(`${WS_BASE_URL}/api/telemetry/ws/crew/${selectedMatatu.id}?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        attempt = 0;
        startDeviceGeolocation();
      };
      ws.onclose = () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        if (simInterval) clearInterval(simInterval);
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        attempt += 1;
        reconnectTimeout = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (simInterval) clearInterval(simInterval);
      ws?.close();
      setGpsSource("idle");
    };
  }, [isBroadcastingGps, selectedMatatu, routeById, token]);

  const handleValidateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSearch) return;
    setTicketError(null);
    startTransition(async () => {
      const result = await getBookingByIdAction(ticketSearch.trim().toUpperCase());
      if (result.error) {
        setTicketError(result.error);
        setScannedTicket(null);
        return;
      }
      setScannedTicket(result.booking || null);
    });
  };

  const handleMarkBoarded = () => {
    if (!scannedTicket) return;
    startTransition(async () => {
      const result = await updateBookingStatusAction(scannedTicket.id, "USED");
      if (result.booking) {
        setScannedTicket(result.booking);
        refreshBookings();
      }
    });
  };

  const handleSendIncident = (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentReport || !incidentLocation || !selectedMatatu) return;
    setIncidentError(null);
    startTransition(async () => {
      const result = await logCrewIncidentAction({
        matatuId: selectedMatatu.id,
        location: incidentLocation,
        description: incidentReport,
      });
      if (result.error) {
        setIncidentError(result.error);
        return;
      }
      setIncidentSent(true);
      setTimeout(() => {
        setIncidentReport("");
        setIncidentLocation("");
        setIncidentSent(false);
      }, 2500);
    });
  };

  if (!selectedMatatu) {
    return (
      <div className="card">
        <EmptyState
          title="No active vehicles assigned to your Sacco"
          hint="Once your Sacco onboards a vehicle and it's marked active, it will appear here for you to drive."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Crew Dashboard"
        title="Driver & Conductor Live Dashboard"
        subtitle="Manage seat occupancy, stream live GPS to the passenger app, validate tickets, and report incidents."
        action={
          <>
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
              <LiveIndicator
                label={`GPS: ${isBroadcastingGps ? (gpsSource === "device" ? "Device GPS Live" : gpsSource === "simulated" ? "Simulated (no fix)" : "Connecting…") : "OFF"}`}
                state={!isBroadcastingGps ? "offline" : gpsSource === "device" ? "live" : "connecting"}
                className="text-white normal-case tracking-normal font-bold"
              />
              <button
                onClick={() => setIsBroadcastingGps(!isBroadcastingGps)}
                className="rounded px-2 py-0.5 text-[10px] font-extrabold bg-white/10 hover:bg-white/20 ml-1"
              >
                Toggle
              </button>
            </div>

            <select
              value={selectedMatatu.id}
              onChange={(e) => {
                const m = matatus.find((m) => m.id === e.target.value) || null;
                setSelectedMatatu(m);
                setScannedTicket(null);
              }}
              className="rounded-lg border-none bg-white/95 px-3 py-2 text-xs font-bold text-county-black focus:outline-none focus:ring-2 focus:ring-county-yellow/60"
            >
              {matatus.map((m) => (
                <option key={m.id} value={m.id}>{m.regNumber} ({m.capacity}-Seater)</option>
              ))}
            </select>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Vehicle Seats" value={selectedMatatu.capacity} hint="Licensed seating capacity" />
        <StatCard label="Full / Occupied Seats" value={fullSeatsCount} accent="red" hint="Confirmed passengers on board" />
        <StatCard label="Empty Seats Available" value={emptySeatsCount} hint="Available for boarding" />
        <StatCard label="Trip Revenue Collected" value={`KES ${totalCollectedKes.toLocaleString()}`} hint="Real booking + cash fares" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4 bg-county-black text-white flex items-center justify-between">
            <div>
              <div className="font-extrabold text-sm text-county-yellow uppercase">Tap Seat to Toggle Occupancy</div>
              <div className="text-xs text-white/60">Empty → records a cash walk-in fare. Occupied → cancels that booking.</div>
            </div>
            <span className="badge bg-county-green text-white font-bold">Live Synced</span>
          </div>

          <SeatMap
            capacity={selectedMatatu.capacity}
            seats={currentSeats}
            onToggleSeatStatus={handleToggleSeat}
            isCrewMode={true}
          />
        </div>

        <div className="space-y-6">
          <div className="card p-5 space-y-4">
            <h3 className="font-bold text-sm text-county-black">Commuter Ticket Validator</h3>
            <form onSubmit={handleValidateTicket} className="flex gap-2">
              <input
                type="text"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                placeholder="Enter Ticket ID (e.g. PASS-178481809975)"
                className="input text-xs"
              />
              <button type="submit" className="btn-primary shrink-0 !py-1.5 text-xs font-bold">Verify</button>
            </form>

            {ticketError && (
              <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2.5 text-xs font-semibold">
                {ticketError}
              </div>
            )}

            {scannedTicket && (
              <div className="bg-black/5 rounded-xl p-3.5 space-y-2 text-xs border border-black/10">
                <div className="flex justify-between items-center border-b border-black/10 pb-1.5">
                  <span className={`font-bold ${scannedTicket.status === "CONFIRMED" ? "text-county-green" : "text-county-blue"}`}>
                    {scannedTicket.status === "USED" ? "ALREADY BOARDED" : "TICKET VALIDATED"}
                  </span>
                  <span className="font-mono font-extrabold">{scannedTicket.id}</span>
                </div>
                <div className="space-y-1 text-black/70">
                  <div>Passenger: <span className="font-bold text-black">{scannedTicket.passengerName}</span></div>
                  <div>Seat Number: <span className="font-bold text-county-blue">Seat {scannedTicket.seatNumbers.join(", ")}</span></div>
                  <div>Route: <span className="font-semibold">{scannedTicket.routeName}</span></div>
                  <div>Fare Payable to Crew: <span className="font-bold text-county-green">KES {scannedTicket.fareKes}</span></div>
                </div>
                {scannedTicket.status === "CONFIRMED" && (
                  <button onClick={handleMarkBoarded} className="btn-primary w-full !py-1.5 text-xs font-bold">
                    Mark as Boarded
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="card p-5 space-y-4">
            <h3 className="font-bold text-sm text-county-black">Alert County Enforcement</h3>
            <p className="text-xs text-black/50">Direct dispatch line to County Traffic & Enforcement Officers.</p>

            {incidentSent ? (
              <div className="bg-county-green/10 text-county-green border border-county-green/30 rounded-lg p-3 text-xs font-bold text-center">
                Incident Alert Sent to County Enforcement!
              </div>
            ) : (
              <form onSubmit={handleSendIncident} className="space-y-3">
                {incidentError && (
                  <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2.5 text-xs font-semibold">
                    {incidentError}
                  </div>
                )}
                <input
                  type="text"
                  value={incidentLocation}
                  onChange={(e) => setIncidentLocation(e.target.value)}
                  placeholder="Location (e.g. Langata Rd Junction)"
                  className="input text-xs"
                  required
                />
                <textarea
                  rows={3}
                  value={incidentReport}
                  onChange={(e) => setIncidentReport(e.target.value)}
                  placeholder="Describe delay, mechanical failure, or route checkpoint status..."
                  className="input text-xs"
                  required
                />
                <button type="submit" className="btn-danger w-full !py-2 text-xs font-bold">
                  Send Rapid Incident Alert
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
