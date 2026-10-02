"use client";

import { useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { recordCrimeAction } from "@/lib/actions";
import { Matatu } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Logging Citation..." : "Submit Offence Citation"}
    </button>
  );
}

const COMMON_OFFENCES = [
  "Overloading Passengers",
  "Operating Off Designated Route",
  "Expired Road Service License",
  "Missing Driver/Conductor Badge",
  "Unroadworthy Vehicle (Defective Brakes/Tires)",
  "Reckless Driving / Speeding",
  "Obstruction / Stopping at Unauthorized Stage",
  "Loud Music System / Modified Exhaust",
  "Other",
];

export default function CrimeRecordModal({ matatus }: { matatus: Matatu[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction] = useFormState(recordCrimeAction, undefined);
  const [offenceCommitted, setOffenceCommitted] = useState("");
  const [photoName, setPhotoName] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="btn-primary !bg-county-red hover:!bg-county-red/90 font-bold"
      >
        + Record Crime / Citation
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl relative max-h-[90vh] flex flex-col">
            <form action={formAction} className="flex flex-col min-h-0">
            <div className="flex justify-between items-center border-b p-6 pb-3 shrink-0">
              <div>
                <h3 className="font-extrabold text-base text-county-black">Record Crime / Offence Citation</h3>
                <p className="text-xs text-black/50">Issue traffic citation and log offence into enforcement records.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-black/40 hover:text-black font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto p-6 pt-4 space-y-3.5">
              {state?.error && (
                <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                  {state.error}
                </div>
              )}
              <div>
                <label className="label">Offence Committed</label>
                <select
                  name="offenceCommitted"
                  required
                  value={offenceCommitted}
                  onChange={(e) => setOffenceCommitted(e.target.value)}
                  className="input font-semibold text-county-red"
                >
                  <option value="" disabled>
                    Select
                  </option>
                  {COMMON_OFFENCES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              {offenceCommitted === "Other" && (
                <div>
                  <label className="label">Describe the Offence</label>
                  <textarea
                    name="offenceOtherText"
                    rows={2}
                    required
                    placeholder="Explain the offence observed..."
                    className="input"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Vehicle Plate Number</label>
                  <input
                    type="text"
                    name="regNumber"
                    required
                    placeholder="e.g. KDA 112B"
                    className="input font-mono font-bold uppercase"
                  />
                </div>
                <div>
                  <label className="label">Fine / Penalty (KES)</label>
                  <input
                    type="number"
                    name="fineAmountKes"
                    required
                    defaultValue={5000}
                    placeholder="5000"
                    className="input font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Driver Name</label>
                  <input
                    type="text"
                    name="driverName"
                    placeholder="e.g. John Mwangi"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Driver License Number</label>
                  <input
                    type="text"
                    name="driverLicense"
                    placeholder="e.g. DL-984920"
                    className="input font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="label">Patrol Checkpoint Location</label>
                <input
                  type="text"
                  name="location"
                  required
                  placeholder="e.g. CBD Tusker Stage Checkpoint"
                  className="input"
                />
              </div>

              <div>
                <label className="label">Photo Evidence (required)</label>
                <input
                  ref={photoInputRef}
                  type="file"
                  name="photo"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  required
                  onChange={(e) => setPhotoName(e.target.files?.[0]?.name || "")}
                  className="block w-full text-xs text-county-black/70 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-county-red/10 file:text-county-red hover:file:bg-county-red/20 border border-black/10 rounded-lg"
                />
                {photoName && (
                  <p className="text-[11px] text-black/50 mt-1">Attached: {photoName}</p>
                )}
                <p className="text-[11px] text-black/40 mt-1">Accepted formats: JPEG, PNG, PDF.</p>
              </div>
            </div>

            <div className="p-6 pt-3 border-t border-black/5 flex gap-3 shrink-0">
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
