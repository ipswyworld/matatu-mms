"use client";

import { Suspense } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { addActivityAction } from "@/lib/actions";

// Mirrors seed data ids from lib/data.ts for the client-side select.
const MATATUS = [
  { id: "m-1", label: "KDA 112B" },
  { id: "m-2", label: "KCY 902K" },
  { id: "m-3", label: "KDB 445T" },
  { id: "m-4", label: "KCF 771P" },
  { id: "m-5", label: "KDD 300L" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving..." : "Log activity"}
    </button>
  );
}

export default function NewActivityPage() {
  return (
    <Suspense fallback={null}>
      <NewActivityForm />
    </Suspense>
  );
}

function NewActivityForm() {
  const [state, formAction] = useFormState(addActivityAction, undefined);
  const searchParams = useSearchParams();
  const presetMatatuId = searchParams.get("matatuId") || "";

  return (
    <div className="max-w-lg">
      <Link href="/activity" className="text-xs font-semibold text-county-green hover:underline">← Back to log</Link>
      <div className="card p-6 mt-3">
        <h2 className="font-bold mb-4">Log vehicle activity</h2>
        <form action={formAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="matatuId">Vehicle</label>
            <select className="input" id="matatuId" name="matatuId" required defaultValue={presetMatatuId}>
              <option value="" disabled>Select a vehicle</option>
              {MATATUS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select className="input" id="type" name="type" defaultValue="TRIP">
              <option value="TRIP">Trip</option>
              <option value="INSPECTION">Inspection</option>
              <option value="INCIDENT">Incident</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="location">Location</label>
            <input className="input" id="location" name="location" placeholder="e.g. Kencom stage" required />
          </div>
          <div>
            <label className="label" htmlFor="description">Description</label>
            <textarea className="input" id="description" name="description" rows={4} placeholder="What happened?" required />
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
