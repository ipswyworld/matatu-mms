"use client";

import { Seat } from "@/lib/types";
import LiveIndicator from "./LiveIndicator";

interface SeatMapProps {
  capacity: number;
  seats: Seat[];
  selectedSeatIds?: number[];
  onToggleSelectSeat?: (seatId: number) => void;
  onToggleSeatStatus?: (seatId: number) => void;
  isCrewMode?: boolean;
}

export default function SeatMap({
  capacity,
  seats,
  selectedSeatIds = [],
  onToggleSelectSeat,
  onToggleSeatStatus,
  isCrewMode = false,
}: SeatMapProps) {
  const isSmallMatatu = capacity <= 14;
  const freeSeatsCount = seats.filter((s) => !s.isOccupied && !s.isReserved).length;

  const getSeatStyling = (seat: Seat) => {
    const isSelected = selectedSeatIds.includes(seat.id);

    if (isSelected) {
      return "bg-county-blue text-white border-county-blue ring-2 ring-county-blue/50 font-bold shadow-lg scale-105";
    }
    if (seat.isOccupied) {
      return "bg-county-red/80 text-white border-county-red cursor-not-allowed opacity-80 shadow-inner";
    }
    if (seat.isReserved) {
      return "bg-amber-500 text-white border-amber-600 font-semibold shadow-sm";
    }
    return "bg-county-green/10 text-county-green border-county-green/30 hover:bg-county-green hover:text-white cursor-pointer transition-all duration-200 font-semibold hover:shadow-md";
  };

  return (
    <div className="bg-county-black rounded-3xl p-6 text-white shadow-2xl border border-white/10 select-none space-y-5">
      {/* Vehicle Header Specs */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <LiveIndicator label={`${capacity}-Seater Matatu Vehicle Layout`} className="text-county-yellow tracking-widest" />
          <div className="text-[11px] text-white/50 mt-0.5">
            {isSmallMatatu ? "Kibo / Nissan Matatu Van (1+2 Layout)" : "Isuzu / Shuttle Bus (2+2 Central Aisle Layout)"}
          </div>
        </div>
        <div className="text-xs font-bold text-white bg-white/10 px-3 py-1.5 rounded-full border border-white/15">
          {freeSeatsCount} / {capacity} Seats Free
        </div>
      </div>

      {/* Realistic Matatu Vehicle Body Chassis Container */}
      <div className="relative mx-auto max-w-md bg-black/30 rounded-t-[50px] rounded-b-[20px] p-5 border-4 border-white/10 shadow-inner space-y-4">
        {/* Front Windshield Glass Curve & Side Mirrors */}
        <div className="relative border-b-2 border-white/10 pb-4">
          {/* Side Mirror Left */}
          <div className="absolute -left-7 top-1 h-8 w-2.5 rounded-l-md bg-white/10 border-l border-white/20" />
          {/* Side Mirror Right */}
          <div className="absolute -right-7 top-1 h-8 w-2.5 rounded-r-md bg-white/10 border-r border-white/20" />

          {/* Windshield Curved Glass Display */}
          <div className="h-10 rounded-t-[40px] bg-gradient-to-b from-sky-400/20 to-black/40 border border-sky-400/30 flex items-center justify-center text-[10px] font-bold text-sky-200 tracking-wider uppercase mb-3">
            Front Windshield / Road View
          </div>

          {/* Driver Cabin Dashboard & Entrance Step */}
          <div className="flex justify-between items-center px-3">
            {/* Steering Wheel & Driver Seat */}
            <div className="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-xl border border-white/10 text-xs">
              <div className="h-6 w-6 rounded-full border-2 border-county-yellow flex items-center justify-center font-bold text-[9px] text-county-yellow">
                W
              </div>
              <span className="font-bold text-white/80">Driver</span>
            </div>

            {/* Entrance Door Indicator */}
            <div className="text-[10px] font-extrabold text-county-green uppercase bg-county-green/10 border border-county-green/30 px-2.5 py-1 rounded-lg">
              ← Main Passenger Door
            </div>
          </div>
        </div>

        {/* Central Corridor Aisle & Seats Grid */}
        <div className="max-h-[360px] overflow-y-auto pr-1 py-1 space-y-3">
          <div
            className="grid gap-3 justify-center"
            style={{ gridTemplateColumns: isSmallMatatu ? "repeat(3, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))" }}
          >
            {seats.map((seat, index) => {
              const isSelected = selectedSeatIds.includes(seat.id);
              return (
                <button
                  key={seat.id}
                  type="button"
                  onClick={() => {
                    if (isCrewMode && onToggleSeatStatus) {
                      onToggleSeatStatus(seat.id);
                    } else if (!seat.isOccupied && onToggleSelectSeat) {
                      onToggleSelectSeat(seat.id);
                    }
                  }}
                  disabled={!isCrewMode && seat.isOccupied}
                  className={`h-14 rounded-xl border flex flex-col items-center justify-center text-xs relative ${getSeatStyling(
                    seat
                  )}`}
                >
                  {/* Seat Cushion Top Cushion Cushion Bar */}
                  <div className={`absolute top-0.5 left-2 right-2 h-1.5 rounded-t-full ${isSelected ? "bg-white/40" : seat.isOccupied ? "bg-white/20" : "bg-county-green/30"}`} />
                  
                  <span className="text-[10px] opacity-75 font-mono">S{seat.id}</span>
                  <span className="font-extrabold text-[11px]">
                    {seat.isOccupied ? "BUSY" : seat.isReserved ? "RES" : `KES ${seat.fareKes}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Rear 5-Seater Bench Chassis Outline */}
        <div className="border-t-2 border-slate-700/80 pt-3 text-center">
          <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">
            Rear Passenger Row
          </span>
        </div>
      </div>

      {/* Interactive Legend & Selection Count */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-2 border-t border-white/10 text-white/70">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-md bg-county-green/20 border border-county-green" />
            <span>Free</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-md bg-county-blue" />
            <span>Selected</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-md bg-amber-500" />
            <span>Reserved</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-md bg-county-red" />
            <span>Occupied</span>
          </div>
        </div>

        {selectedSeatIds.length > 0 && (
          <div className="font-bold text-county-yellow bg-county-yellow/10 px-3 py-1 rounded-lg border border-county-yellow/20">
            {selectedSeatIds.length} {selectedSeatIds.length === 1 ? "Seat" : "Seats"} Selected
          </div>
        )}
      </div>
    </div>
  );
}
