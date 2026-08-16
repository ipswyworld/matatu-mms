"use client";

import { useRef, useState, useTransition } from "react";
import { fileEnforcementCaseAction } from "@/lib/actions";
import { OffenceType } from "@/lib/types";

const ACTIONS: { value: string; label: string }[] = [
  { value: "IMPOUND", label: "Impound Vehicle" },
  { value: "SELF_DRIVE_IMPOUND", label: "Self-Drive + Impound" },
  { value: "TOLL", label: "Toll (fine only, vehicle released to continue)" },
];

export default function EnforcementSceneForm({ offenceTypes }: { offenceTypes: OffenceType[] }) {
  const [regNumber, setRegNumber] = useState("");
  const [offenceTypeId, setOffenceTypeId] = useState(offenceTypes[0]?.id || "");
  const [offenceDescription, setOffenceDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("IMPOUND");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedOffence = offenceTypes.find((o) => o.id === offenceTypeId);

  const handleSubmit = () => {
    if (!regNumber.trim()) {
      setError("Enter the vehicle plate number.");
      return;
    }
    if (selectedOffence?.isOther && !offenceDescription.trim()) {
      setError("Describe the offence since you selected 'Other'.");
      return;
    }
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setError("At least one scene photo is required to file a case.");
      return;
    }
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("regNumber", regNumber.trim().toUpperCase());
    formData.set("offenceTypeId", offenceTypeId);
    formData.set("offenceDescription", offenceDescription.trim());
    formData.set("actionTaken", actionTaken);
    Array.from(files).forEach((f) => formData.append("photos", f));

    startTransition(async () => {
      const result = await fileEnforcementCaseAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(result.caseReference || "Case filed.");
      setRegNumber("");
      setOffenceDescription("");
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <div className="card p-5 space-y-4 max-w-xl">
      <div>
        <h3 className="font-bold text-sm text-county-black">Report Offence at Scene</h3>
        <p className="text-xs text-black/50">
          The fine amount locks automatically from the offence you select — it is fixed by county officials and
          cannot be adjusted in the field.
        </p>
      </div>

      {error && (
        <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-3 rounded-lg font-semibold">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-county-green/10 border border-county-green/30 text-county-green text-sm p-3 rounded-lg font-bold">
          Case filed. Reference number: <span className="font-mono">{success}</span>
          <p className="text-[11px] font-semibold text-black/60 mt-1">
            Give this reference to the driver — they use it to pay at /pay-fine without needing an account.
          </p>
        </div>
      )}

      <div>
        <label className="label">Vehicle Plate Number</label>
        <input
          value={regNumber}
          onChange={(e) => setRegNumber(e.target.value)}
          placeholder="e.g. KDA 112B"
          className="input font-mono font-bold uppercase"
        />
      </div>

      <div>
        <label className="label">Offence Committed</label>
        <select
          value={offenceTypeId}
          onChange={(e) => setOffenceTypeId(e.target.value)}
          className="input font-semibold"
        >
          {offenceTypes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} {!o.isOther && `— KES ${o.defaultFineKes.toLocaleString()}`}
            </option>
          ))}
        </select>
        {selectedOffence && !selectedOffence.isOther && (
          <p className="text-[11px] text-black/50 mt-1">
            Fine locked at <strong>KES {selectedOffence.defaultFineKes.toLocaleString()}</strong> — this is fixed, not editable.
          </p>
        )}
      </div>

      {selectedOffence?.isOther && (
        <div>
          <label className="label">Describe the Offence</label>
          <textarea
            value={offenceDescription}
            onChange={(e) => setOffenceDescription(e.target.value)}
            rows={2}
            className="input"
            placeholder="Describe what happened for the case record"
          />
        </div>
      )}

      <div>
        <label className="label">Action Taken</label>
        <select value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} className="input font-semibold">
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Scene Photo(s) — required</label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          required
          className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-black/5 file:px-3 file:py-1.5 file:text-xs file:font-bold"
        />
      </div>

      <button onClick={handleSubmit} disabled={isPending} className="btn-primary w-full font-bold">
        {isPending ? "Filing Case..." : "File Case"}
      </button>
    </div>
  );
}
