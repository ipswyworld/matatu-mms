"use client";

import { useState, useTransition } from "react";
import { FileText } from "lucide-react";
import { DataSubjectRequest } from "@/lib/types";
import { createDsrAction, updateDsrAction, CreateDsrInput } from "@/lib/actions";
import ActionButton from "@/components/ActionButton";

const STATUS_STYLE: Record<string, string> = {
  RECEIVED: "bg-black/5 text-black/60",
  IN_PROGRESS: "bg-amber-100 text-amber-800",
  FULFILLED: "bg-county-green/10 text-county-green",
  REJECTED: "bg-county-red/10 text-county-red",
};

function RequestRow({ request }: { request: DataSubjectRequest }) {
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes] = useState(request.resolutionNotes || "");

  return (
    <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="badge text-[9px] font-bold bg-black/5 text-black/60">{request.requestType}</span>
            <span className={`badge text-[9px] font-extrabold ${STATUS_STYLE[request.status]}`}>{request.status}</span>
            <span className="font-semibold text-xs text-county-black">{request.subjectName}</span>
            <span className="text-[11px] text-black/40">{request.subjectContact}</span>
          </div>
          <p className="text-[11px] text-black/60 mt-1">{request.description}</p>
          <p className="text-[10px] text-black/35 mt-0.5">
            Received {new Date(request.receivedAt).toLocaleString()}
            {request.resolvedAt && ` · Resolved ${new Date(request.resolvedAt).toLocaleString()}`}
          </p>
        </div>
      </div>

      {request.status !== "FULFILLED" && request.status !== "REJECTED" && (
        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-black/5">
          <div>
            <label className="label text-[10px]">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as DataSubjectRequest["status"])} className="input text-[11px] py-1">
              <option value="RECEIVED">Received</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="FULFILLED">Fulfilled</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label text-[10px]">Resolution notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-[11px] py-1" placeholder="What was done" />
          </div>
          <ActionButton
            actionId="dsr.update"
            target={`${request.subjectName}'s ${request.requestType.toLowerCase()} request`}
            onConfirm={(reason) => updateDsrAction(request.id, status, notes, reason)}
            className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 transition-colors"
          >
            Save
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function IntakeForm() {
  const [form, setForm] = useState<CreateDsrInput>({ requestType: "ACCESS", subjectName: "", subjectContact: "", description: "" });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!form.subjectName.trim() || !form.subjectContact.trim() || !form.description.trim()) {
      setError("Name, contact, and description are all required.");
      return;
    }
    startTransition(async () => {
      const result = await createDsrAction(form);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setForm({ requestType: "ACCESS", subjectName: "", subjectContact: "", description: "" });
      }
    });
  }

  return (
    <div className="pt-2 border-t border-black/5 space-y-2">
      <div className="grid sm:grid-cols-4 gap-2">
        <select value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value })} className="input text-xs">
          <option value="ACCESS">Access</option>
          <option value="CORRECTION">Correction</option>
          <option value="DELETION">Deletion</option>
          <option value="OBJECTION">Objection</option>
        </select>
        <input value={form.subjectName} onChange={(e) => setForm({ ...form, subjectName: e.target.value })} placeholder="Name" className="input text-xs" />
        <input value={form.subjectContact} onChange={(e) => setForm({ ...form, subjectContact: e.target.value })} placeholder="Phone or email" className="input text-xs" />
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What they're asking for" className="input text-xs" />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="btn-primary text-xs px-4 py-2 disabled:opacity-50"
      >
        {pending ? "Recording…" : "Record request"}
      </button>
      {error && <p className="text-xs text-county-red font-semibold">{error}</p>}
    </div>
  );
}

export default function DataSubjectRequestsPanel({ requests }: { requests: DataSubjectRequest[] }) {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
          <FileText size={15} strokeWidth={2} className="text-county-ink/50" />
          Data Subject Requests
        </h3>
        <p className="text-xs text-black/50 mt-0.5">
          Kenya DPA access/correction/deletion/objection requests — intake and tracking. Fulfilling one still means a
          human finds and handles the actual records.
        </p>
      </div>

      {requests.length === 0 ? (
        <p className="text-xs text-black/40 italic">No requests recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} request={r} />
          ))}
        </div>
      )}

      <IntakeForm />
    </div>
  );
}
