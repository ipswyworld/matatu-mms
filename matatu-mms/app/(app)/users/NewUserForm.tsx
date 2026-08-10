"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addUserAction } from "@/lib/actions";
import { Role, Sacco } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Adding..." : "Add user"}
    </button>
  );
}

export default function NewUserForm({ saccos }: { saccos: Sacco[] }) {
  const [state, formAction] = useFormState(addUserAction, undefined);
  const [role, setRole] = useState<Role>("VIEWER");

  return (
    <div className="card p-5 h-fit">
      <h3 className="font-bold text-sm mb-4">Add a user</h3>
      <form action={formAction} className="space-y-3">
        <div>
          <label className="label" htmlFor="name">Full name</label>
          <input className="input" id="name" name="name" required />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Temporary password</label>
          <input className="input" id="password" name="password" type="text" required />
        </div>
        <div>
          <label className="label" htmlFor="role">Role</label>
          <select
            className="input"
            id="role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="ADMIN">System Administrator</option>
            <option value="ENFORCEMENT">Enforcement Officer</option>
            <option value="SACCO_OPERATOR">Sacco Operator</option>
            <option value="VIEWER">Viewer / Executive</option>
          </select>
        </div>
        {role === "SACCO_OPERATOR" && (
          <div>
            <label className="label" htmlFor="saccoId">Sacco</label>
            <select className="input" id="saccoId" name="saccoId" required defaultValue="">
              <option value="" disabled>Select a sacco</option>
              {saccos.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {state?.error && (
          <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2">
            {state.error}
          </div>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
