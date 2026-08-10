"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { onboardSaccoVehicleAction } from "@/lib/actions";
import { Route } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Submitting Vehicle..." : "Onboard Vehicle under Sacco"}
    </button>
  );
}

export default function OnboardVehicleModal({ saccoId, routes }: { saccoId: string; routes: Route[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction] = useFormState(onboardSaccoVehicleAction, undefined);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="btn-primary font-bold shadow-md"
      >
        + Onboard New Vehicle
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-extrabold text-base text-county-black">Onboard Vehicle under Sacco</h3>
                <p className="text-xs text-black/50">Register a new matatu into your Sacco fleet with terminal segment details.</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-black/40 hover:text-black font-bold text-lg"
              >
                ✕
              </button>
            </div>

            {state?.error && (
              <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                {state.error}
              </div>
            )}

            <form action={formAction} className="space-y-3.5">
              <input type="hidden" name="saccoId" value={saccoId} />

              <div>
                <label className="label">Vehicle Registration Plate Number</label>
                <input
                  type="text"
                  name="regNumber"
                  required
                  placeholder="e.g. KDA 112B"
                  className="input font-mono font-bold uppercase"
                />
              </div>

              <div>
                <label className="label">Assigned Route Corridor</label>
                <select name="routeId" required className="input font-semibold">
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      Route {r.code} - {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Terminal & Stage Route Segment</label>
                <input
                  type="text"
                  name="terminalSegment"
                  required
                  placeholder="e.g. CBD-Umoja Terminal: Tusker Stage"
                  className="input font-semibold"
                />
                <p className="text-[10px] text-black/40 mt-1">
                  Specifies origin terminal and key stage for passenger booking & scheduling.
                </p>
              </div>

              <div>
                <label className="label">Seating Capacity</label>
                <select name="capacity" defaultValue={14} className="input font-bold">
                  <option value={14}>14 Seats (Standard Matatu Van)</option>
                  <option value={23}>23 Seats (Mini-Bus)</option>
                  <option value={33}>33 Seats (Standard Matatu Bus)</option>
                  <option value={45}>45 Seats (Large County Bus)</option>
                  <option value={51}>51 Seats (High Capacity Bus)</option>
                  <option value={61}>61 Seats (Heavy Transit Bus)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-black/5">
                <div className="col-span-2">
                  <h4 className="text-xs font-extrabold text-black/70 uppercase tracking-wider">Driver Details</h4>
                </div>
                <div>
                  <label className="label">Driver Full Name</label>
                  <input type="text" name="driverName" required placeholder="e.g. James Omwamba" className="input" />
                </div>
                <div>
                  <label className="label">Driver Driving License No.</label>
                  <input type="text" name="driverLicense" required placeholder="e.g. DL-4471829" className="input font-mono" />
                </div>
                <div className="col-span-2">
                  <label className="label">Driver Phone Contact</label>
                  <input type="tel" name="driverPhone" required placeholder="e.g. +254712345678" className="input" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-black/5">
                <div className="col-span-2">
                  <h4 className="text-xs font-extrabold text-black/70 uppercase tracking-wider">Conductor Details</h4>
                </div>
                <div>
                  <label className="label">Conductor Full Name</label>
                  <input type="text" name="conductorName" required placeholder="e.g. Peter Otieno" className="input" />
                </div>
                <div>
                  <label className="label">Conductor Driving License No.</label>
                  <input type="text" name="conductorLicense" required placeholder="e.g. DL-8827341" className="input font-mono" />
                </div>
                <div className="col-span-2">
                  <label className="label">Conductor Phone Contact</label>
                  <input type="tel" name="conductorPhone" required placeholder="e.g. +254798765432" className="input" />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <div className="flex-1">
                  <SubmitButton />
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
