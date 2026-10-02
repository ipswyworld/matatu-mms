"use client";

import { useState, useTransition } from "react";
import { UserPlus, Send, Trash2 } from "lucide-react";
import { addShadowSaccosAction, inviteShadowSaccoAction, deleteShadowSaccoAction } from "@/lib/actions";
import { ComplianceFunnel } from "@/lib/types";

function DeadlineBadge({ daysRemaining }: { daysRemaining?: number }) {
  if (daysRemaining === undefined || daysRemaining === null) {
    return <span className="text-[10px] text-black/30 italic">No deadline set</span>;
  }
  if (daysRemaining < 0) {
    return <span className="badge bg-county-red/10 text-county-red font-bold">{Math.abs(daysRemaining)}d overdue</span>;
  }
  if (daysRemaining <= 7) {
    return <span className="badge bg-county-red/10 text-county-red font-bold">{daysRemaining}d left</span>;
  }
  if (daysRemaining <= 21) {
    return <span className="badge bg-county-yellow/20 text-yellow-800 font-bold">{daysRemaining}d left</span>;
  }
  return <span className="badge bg-black/5 text-black/50 font-bold">{daysRemaining}d left</span>;
}

export default function ShadowRegistryPanel({ funnel }: { funnel: ComplianceFunnel }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    if (!name.trim() || !contactPhone.trim()) {
      setError("An operator name and contact phone are both required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addShadowSaccosAction([
        {
          name: name.trim(),
          contactName: contactName.trim() || undefined,
          contactPhone: contactPhone.trim(),
          complianceDeadline: deadline ? new Date(deadline).toISOString() : undefined,
        },
      ]);
      if (result.error) { setError(result.error); return; }
      setName("");
      setContactName("");
      setContactPhone("");
      setDeadline("");
      setShowAdd(false);
    });
  };

  const handleInvite = (saccoId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await inviteShadowSaccoAction(saccoId);
      if (result.error) setError(result.error);
    });
  };

  const handleRemove = (saccoId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await deleteShadowSaccoAction(saccoId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-sm text-county-black">Unregistered Operators — Compliance Outreach</h3>
          <p className="text-xs text-black/50 mt-0.5">
            Operators the county knows about (route permits, prior records) who haven't registered on the system yet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-county-red/10 text-county-red font-bold">{funnel.unregistered} unregistered</span>
          <span className="badge bg-county-yellow/20 text-yellow-800 font-bold">{funnel.invited} invited</span>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="btn-secondary !py-1.5 !px-3 text-xs font-bold flex items-center gap-1.5"
          >
            <UserPlus size={13} strokeWidth={2} />
            Add Operator
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-2.5 rounded-lg font-semibold">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] grid sm:grid-cols-2 gap-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Operator / Sacco name *" className="input text-xs" />
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Contact phone *" className="input text-xs" />
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact person (optional)" className="input text-xs" />
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input text-xs" />
          <div className="sm:col-span-2 flex gap-2">
            <button disabled={isPending} onClick={handleAdd} className="btn-primary !py-1.5 text-xs font-bold flex-1">
              {isPending ? "Adding..." : "Add to Registry"}
            </button>
            <button onClick={() => setShowAdd(false)} className="btn-secondary !py-1.5 text-xs font-bold">Cancel</button>
          </div>
        </div>
      )}

      {funnel.entries.length === 0 ? (
        <p className="text-center text-xs text-black/40 py-4">No unregistered operators on record — nice.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-black/5 text-black/60 uppercase text-[10px]">
              <tr>
                <th className="p-2.5">Operator</th>
                <th className="p-2.5">Contact</th>
                <th className="p-2.5">Deadline</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {funnel.entries.map((e) => (
                <tr key={e.id} className="hover:bg-black/[0.02]">
                  <td className="p-2.5 font-bold text-county-black">{e.name}</td>
                  <td className="p-2.5 font-mono">{e.contactPhone || "—"}</td>
                  <td className="p-2.5"><DeadlineBadge daysRemaining={e.daysRemaining} /></td>
                  <td className="p-2.5">
                    <span className={`badge font-bold ${e.status === "INVITED" ? "bg-county-blue/10 text-county-blue" : "bg-county-red/10 text-county-red"}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="p-2.5">
                    <div className="flex items-center gap-2">
                      {e.status === "UNREGISTERED" && (
                        <button
                          disabled={isPending}
                          onClick={() => handleInvite(e.id)}
                          className="text-[10px] font-bold text-white bg-county-blue rounded px-2 py-1 flex items-center gap-1 disabled:opacity-40"
                        >
                          <Send size={10} strokeWidth={2.5} />
                          Invite (SMS)
                        </button>
                      )}
                      <button
                        disabled={isPending}
                        onClick={() => handleRemove(e.id)}
                        title="Remove from registry (e.g. they've since registered for real)"
                        className="text-black/40 hover:text-county-red disabled:opacity-40"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
