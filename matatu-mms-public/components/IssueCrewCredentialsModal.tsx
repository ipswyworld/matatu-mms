"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { issueCrewCredentialsAction } from "@/lib/actions";
import { Matatu } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Issuing Credentials..." : "Issue Crew Login"}
    </button>
  );
}

export default function IssueCrewCredentialsModal({ matatus }: { matatus: Matatu[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction] = useFormState(issueCrewCredentialsAction, undefined);
  const [copied, setCopied] = useState(false);

  // Reset the one-time-password copy state whenever a fresh success comes in.
  useEffect(() => {
    setCopied(false);
  }, [state?.success?.generatedPassword]);

  const close = () => {
    setIsOpen(false);
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="btn-primary font-bold shadow-md">
        + Issue Crew Login
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl relative max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b p-5 pb-3 shrink-0">
              <div>
                <h3 className="font-extrabold text-base text-county-black">Issue Crew Login</h3>
                <p className="text-xs text-black/50">
                  Assign a driver or conductor to a vehicle and generate their login credentials.
                </p>
              </div>
              <button type="button" onClick={close} className="text-black/40 hover:text-black font-bold text-lg">
                ✕
              </button>
            </div>

            {state?.success ? (
              <div className="p-5 space-y-4">
                <div className="bg-county-green/10 border border-county-green/30 rounded-lg p-4 space-y-3">
                  <p className="text-xs font-bold text-county-green">
                    Login issued for {state.success.crewName} on {state.success.matatuRegNumber}.
                  </p>
                  <p className="text-[11px] text-black/60">
                    Share these credentials with the crew member now — the password will not be shown again.
                  </p>
                  <div className="bg-white rounded-lg border border-black/10 p-3 space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-black/40">Email</span>
                      <span className="font-bold">{state.success.crewEmail}</span>
                    </div>
                    <div className="flex justify-between gap-2 items-center">
                      <span className="text-black/40">Password</span>
                      <span className="font-bold">{state.success.generatedPassword}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `Email: ${state.success!.crewEmail}\nPassword: ${state.success!.generatedPassword}`
                      );
                      setCopied(true);
                    }}
                    className="btn-secondary w-full text-xs"
                  >
                    {copied ? "Copied to clipboard" : "Copy credentials"}
                  </button>
                </div>
                <button type="button" onClick={close} className="btn-primary w-full">
                  Done
                </button>
              </div>
            ) : (
              <form action={formAction} className="flex flex-col min-h-0">
                <div className="overflow-y-auto p-5 pt-4 space-y-4">
                  {state?.error && (
                    <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                      {state.error}
                    </div>
                  )}

                  <div>
                    <label className="label">Vehicle</label>
                    <select name="matatuId" required className="input font-semibold">
                      {matatus.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.regNumber}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Crew Role</label>
                    <select name="crewRole" required defaultValue="DRIVER" className="input font-semibold">
                      <option value="DRIVER">Driver</option>
                      <option value="CONDUCTOR">Conductor</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Full Name</label>
                      <input type="text" name="name" required placeholder="Full name" className="input" />
                    </div>
                    <div>
                      <label className="label">Phone</label>
                      <input type="tel" name="phone" placeholder="Phone" className="input" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Login Email</label>
                      <input type="email" name="email" required placeholder="crew@example.com" className="input" />
                    </div>
                    <div>
                      <label className="label">License No.</label>
                      <input type="text" name="licenseNumber" placeholder="License No." className="input font-mono" />
                    </div>
                  </div>
                </div>

                <div className="p-5 pt-3 border-t border-black/5 flex gap-3 shrink-0">
                  <button type="button" onClick={close} className="btn-secondary flex-1">
                    Cancel
                  </button>
                  <div className="flex-1">
                    <SubmitButton />
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
