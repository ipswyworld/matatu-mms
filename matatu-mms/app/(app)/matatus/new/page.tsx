"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { addMatatuAction } from "@/lib/actions";

// Static reference data mirrored from lib/data seed (safe for a client form; ids must match).
const SACCOS = [
  { id: "sacco-1", name: "Umoinner Sacco" },
  { id: "sacco-2", name: "Rembo Shuttle Sacco" },
  { id: "sacco-3", name: "Kenya Mpya Sacco" },
];
const ROUTES = [
  { id: "route-1", name: "111 · CBD - Rongai" },
  { id: "route-2", name: "58 · CBD - Kasarani" },
  { id: "route-3", name: "34 · CBD - Kawangware" },
  { id: "route-4", name: "125 · CBD - Umoja" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving..." : "Register vehicle"}
    </button>
  );
}

export default function NewMatatuPage() {
  const [state, formAction] = useFormState(addMatatuAction, undefined);

  return (
    <div className="max-w-lg">
      <Link href="/matatus" className="text-xs font-semibold text-county-green hover:underline">← Back to registry</Link>
      <div className="card p-6 mt-3">
        <h2 className="font-bold mb-4">Register a vehicle</h2>
        <form action={formAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="regNumber">Registration number</label>
            <input className="input" id="regNumber" name="regNumber" placeholder="KDA 112B" required />
          </div>
          <div>
            <label className="label" htmlFor="saccoId">Sacco</label>
            <select className="input" id="saccoId" name="saccoId" required defaultValue="">
              <option value="" disabled>Select a sacco</option>
              {SACCOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="routeId">Route</label>
            <select className="input" id="routeId" name="routeId" required defaultValue="">
              <option value="" disabled>Select a route</option>
              {ROUTES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="capacity">Seating capacity</label>
            <input className="input" id="capacity" name="capacity" type="number" min={1} max={67} placeholder="33" required />
          </div>

          {state?.error && (
            <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2">
              {state.error}
            </div>
          )}

          <SubmitButton />
        </form>
      </div>
    </div>
  );
}
