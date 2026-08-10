"use client";

import { Suspense } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { issueFineAction } from "@/lib/actions";

const MATATUS = [
  { id: "m-1", label: "KDA 112B" },
  { id: "m-2", label: "KCY 902K" },
  { id: "m-3", label: "KDB 445T" },
  { id: "m-4", label: "KCF 771P" },
  { id: "m-5", label: "KDD 300L" },
];

const COMMON_REASONS = [
  "Overloading beyond licensed capacity",
  "Unroadworthy vehicle",
  "Expired route badge / PSV licence",
  "Reckless / dangerous driving",
  "Failure to display fare charges",
  "Operating outside licensed route",
  "Other",
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Issuing..." : "Issue fine"}
    </button>
  );
}

export default function NewFinePage() {
  return (
    <Suspense fallback={null}>
      <NewFineForm />
    </Suspense>
  );
}

function NewFineForm() {
  const [state, formAction] = useFormState(issueFineAction, undefined);
  const searchParams = useSearchParams();
  const presetMatatuId = searchParams.get("matatuId") || "";

  return (
    <div className="max-w-lg">
      <Link href="/fines" className="text-xs font-semibold text-county-green hover:underline">← Back to fines</Link>
      <div className="card p-6 mt-3">
        <h2 className="font-bold mb-4">Issue a fine</h2>
        <form action={formAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="matatuId">Vehicle</label>
            <select className="input" id="matatuId" name="matatuId" required defaultValue={presetMatatuId}>
              <option value="" disabled>Select a vehicle</option>
              {MATATUS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reason">Reason</label>
            <select className="input" id="reason" name="reason" required defaultValue="">
              <option value="" disabled>Select a reason</option>
              {COMMON_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="amountKes">Amount (KES)</label>
            <input className="input" id="amountKes" name="amountKes" type="number" min={500} step={500} placeholder="5000" required />
          </div>
          <div>
            <label className="label" htmlFor="dueDate">Due date</label>
            <input className="input" id="dueDate" name="dueDate" type="date" required />
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
