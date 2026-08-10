"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addRouteAction } from "@/lib/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Adding Route..." : "Add Route Corridor"}
    </button>
  );
}

export default function AddRouteModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction] = useFormState(addRouteAction, undefined);

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="rounded-lg px-3.5 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors">
        + Add Route Corridor
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl relative">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-extrabold text-base text-county-black">Add Route Corridor</h3>
              <button onClick={() => setIsOpen(false)} className="text-black/40 hover:text-black font-bold text-lg">✕</button>
            </div>

            {state?.error && (
              <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
                {state.error}
              </div>
            )}

            <form action={formAction} className="space-y-3.5">
              <div>
                <label className="label">Route Code</label>
                <input type="text" name="code" required placeholder="e.g. 237" className="input font-mono font-bold" />
              </div>
              <div>
                <label className="label">Route Name</label>
                <input type="text" name="name" required placeholder="e.g. CBD - Dagoretti" className="input" />
              </div>
              <div>
                <label className="label">Description</label>
                <input type="text" name="description" placeholder="e.g. Nairobi CBD to Dagoretti via Ngong Rd" className="input" />
              </div>
              <div>
                <label className="label">Fare (KES per seat)</label>
                <input type="number" name="fareKes" required min={1} placeholder="e.g. 100" className="input font-bold" />
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary flex-1">Cancel</button>
                <div className="flex-1"><SubmitButton /></div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
