"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { onboardSaccoVehicleAction } from "@/lib/actions";
import { Route } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Submitting Vehicle..." : "Onboard Vehicle under Operator"}
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
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl relative max-h-[90vh] flex flex-col">
            <form action={formAction} className="flex flex-col min-h-0">
            <div className="flex justify-between items-center border-b p-5 pb-3 shrink-0">
              <div>
                <h3 className="font-extrabold text-base text-county-black">Onboard Vehicle under Operator</h3>
                <p className="text-xs text-black/50">Register a new matatu into your Operator fleet with terminal segment details.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-black/40 hover:text-black font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto p-5 pt-4 space-y-4">
              <input type="hidden" name="saccoId" value={saccoId} />

              {state?.error && (
                <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                  {state.error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Plate Number</label>
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Terminal & Stage Segment</label>
                  <input
                    type="text"
                    name="terminalSegment"
                    required
                    placeholder="e.g. CBD-Umoja Terminal: Tusker Stage"
                    className="input font-semibold"
                  />
                </div>
                <div>
                  <label className="label">Seating Capacity</label>
                  <select name="capacity" defaultValue={14} className="input font-bold">
                    <option value={14}>14 Seats (Standard Van)</option>
                    <option value={23}>23 Seats (Mini-Bus)</option>
                    <option value={33}>33 Seats (Standard Bus)</option>
                    <option value={45}>45 Seats (Large Bus)</option>
                    <option value={51}>51 Seats (High Capacity Bus)</option>
                    <option value={61}>61 Seats (Heavy Transit Bus)</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-black/5">
                <h4 className="text-xs font-extrabold text-black/70 uppercase tracking-wider mb-2.5">Driver Details</h4>
                <div className="grid grid-cols-3 gap-3">
                  <input type="text" name="driverName" required placeholder="Full name" aria-label="Driver Full Name" className="input" />
                  <input type="text" name="driverLicense" required placeholder="License No." aria-label="Driver License" className="input font-mono" />
                  <input type="tel" name="driverPhone" required placeholder="Phone" aria-label="Driver Phone" className="input" />
                </div>
              </div>

              <div className="pt-3 border-t border-black/5">
                <h4 className="text-xs font-extrabold text-black/70 uppercase tracking-wider mb-2.5">Conductor Details</h4>
                <div className="grid grid-cols-3 gap-3">
                  <input type="text" name="conductorName" required placeholder="Full name" aria-label="Conductor Full Name" className="input" />
                  <input type="text" name="conductorLicense" required placeholder="License No." aria-label="Conductor License" className="input font-mono" />
                  <input type="tel" name="conductorPhone" required placeholder="Phone" aria-label="Conductor Phone" className="input" />
                </div>
              </div>
            </div>

            <div className="p-5 pt-3 border-t border-black/5 flex gap-3 shrink-0">
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
