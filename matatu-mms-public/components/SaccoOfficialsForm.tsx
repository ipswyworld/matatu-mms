"use client";

import { useFormState } from "react-dom";
import { updateSaccoOfficialsAction } from "@/lib/actions";
import { SaccoOfficialContact } from "@/lib/types";

export default function SaccoOfficialsForm({
  saccoId,
  officials,
}: {
  saccoId: string;
  officials?: SaccoOfficialContact;
}) {
  const boundAction = updateSaccoOfficialsAction.bind(null, saccoId);
  const [state, formAction] = useFormState(boundAction, undefined);

  return (
    <form action={formAction} className="p-3 rounded-lg border border-black/10 bg-black/[0.01] space-y-2.5 text-xs">
      {state?.error && (
        <div className="bg-county-red/10 border border-county-red/30 text-county-red text-[11px] p-2 rounded font-semibold">
          {state.error}
        </div>
      )}
      {(
        [
          ["chairpersonName", "Chairperson Name", officials?.chairpersonName],
          ["chairpersonPhone", "Chairperson Phone", officials?.chairpersonPhone],
          ["secretaryName", "Secretary Name", officials?.secretaryName],
          ["secretaryPhone", "Secretary Phone", officials?.secretaryPhone],
          ["treasurerName", "Treasurer Name", officials?.treasurerName],
          ["treasurerPhone", "Treasurer Phone", officials?.treasurerPhone],
        ] as [string, string, string | undefined][]
      ).map(([name, label, defaultValue]) => (
        <div key={name} className="flex items-center gap-2">
          <label className="w-32 shrink-0 text-black/60 font-semibold">{label}</label>
          <input
            name={name}
            required
            defaultValue={defaultValue}
            className="flex-1 min-w-0 border border-black/15 rounded px-2 py-1 focus:outline-none focus:border-county-green"
          />
        </div>
      ))}
      <button type="submit" className="btn-primary !py-1.5 text-[11px] font-bold w-full">
        Save Bonafide Officials
      </button>
    </form>
  );
}
