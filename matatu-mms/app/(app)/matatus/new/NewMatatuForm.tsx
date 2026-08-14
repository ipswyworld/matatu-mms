"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addMatatuAction } from "@/lib/actions";
import { Role, Route, Sacco } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving..." : "Register vehicle"}
    </button>
  );
}

export default function NewMatatuForm({
  viewerRole,
  viewerSaccoId,
  saccos,
  routes,
}: {
  viewerRole: Role;
  viewerSaccoId?: string;
  saccos: Sacco[];
  routes: Route[];
}) {
  const [state, formAction] = useFormState(addMatatuAction, undefined);
  const isOperator = viewerRole === "SACCO_OPERATOR";

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="regNumber">Registration number</label>
        <input className="input" id="regNumber" name="regNumber" placeholder="KDA 112B" required />
      </div>

      {isOperator ? (
        <input type="hidden" name="saccoId" value={viewerSaccoId} />
      ) : (
        <div>
          <label className="label" htmlFor="saccoId">Operator</label>
          <select className="input" id="saccoId" name="saccoId" required defaultValue="">
            <option value="" disabled>Select an operator</option>
            {saccos.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="label" htmlFor="routeId">Route</label>
        <select className="input" id="routeId" name="routeId" required defaultValue="">
          <option value="" disabled>Select a route</option>
          {routes.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
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
  );
}
