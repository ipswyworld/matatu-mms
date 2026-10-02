"use client";

import { useState, useTransition } from "react";
import { Check, Copy, UserPlus, X } from "lucide-react";
import { createOfficerAction } from "@/lib/actions";
import { PTCU_RANKS } from "./OfficerPicker";

// Enforcement-family roles only — a commander using this door cannot mint
// any other account type, even by tampering with the request, since the
// backend re-checks this server-side against the add_officer permission.
const OFFICER_ROLES = [
  { value: "ENFORCEMENT", label: "Enforcement" },
  { value: "ARRESTING_OFFICER", label: "Arresting Officer" },
  { value: "RELEASING_OFFICER", label: "Releasing Officer" },
  { value: "ENFORCEMENT_COMMANDER", label: "Enforcement Commander" },
];

/**
 * Bringing a new officer into the system — the commander-facing door,
 * separate from the full admin "create user" form. Filled in from the
 * sheet: name, manpower number, rank, phone. No password to invent — one
 * is generated and shown once, the same way an invite code would be.
 */
export default function AddOfficerForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [manpowerNo, setManpowerNo] = useState("");
  const [rank, setRank] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("ENFORCEMENT");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setName("");
    setManpowerNo("");
    setRank("");
    setPhone("");
    setRole("ENFORCEMENT");
    setError(null);
  };

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("An officer needs a name.");
    if (!manpowerNo.trim()) return setError("An officer needs a manpower number.");

    startTransition(async () => {
      const res = await createOfficerAction({
        name: name.trim(),
        role,
        manpowerNo: manpowerNo.trim(),
        rank: rank || undefined,
        phone: phone.trim() || undefined,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult({ name: name.trim(), tempPassword: res.tempPassword! });
      reset();
    });
  };

  const copyPassword = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.tempPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (result) {
    return (
      <div className="card p-5 space-y-3 border-county-green/30">
        <h3 className="font-bold text-sm text-county-black">
          {result.name} added
        </h3>
        <p className="text-[11px] text-black/50">
          Temporary password — shown once. Give this to the officer; they can change it after signing in.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2">
          <code className="flex-1 text-xs font-mono font-bold text-county-black">{result.tempPassword}</code>
          <button type="button" onClick={copyPassword} aria-label="Copy password" className="text-black/40 hover:text-county-green">
            {copied ? <Check size={14} strokeWidth={2.5} className="text-county-green" /> : <Copy size={14} strokeWidth={2} />}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setResult(null)}
          className="btn-secondary w-full !py-2 text-xs font-bold"
        >
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary !py-2 text-xs font-bold flex items-center gap-1.5"
      >
        <UserPlus size={13} strokeWidth={2} />
        Add officer
      </button>
    );
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-start justify-between">
        <h3 className="font-bold text-sm text-county-black">Add officer</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          aria-label="Close"
          className="text-black/30 hover:text-black/60"
        >
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-county-red/10 border border-county-red/30 p-2.5 text-xs font-semibold text-county-red">
          {error}
        </div>
      )}

      <div>
        <label className="text-[11px] font-bold text-black/50 block mb-1">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brian Kiprop" className="input text-xs w-full" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Manpower number</label>
          <input value={manpowerNo} onChange={(e) => setManpowerNo(e.target.value)} placeholder="74786" className="input text-xs w-full" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Rank</label>
          <select value={rank} onChange={(e) => setRank(e.target.value)} className="input text-xs w-full">
            <option value="">—</option>
            {PTCU_RANKS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Phone (optional)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0722…" className="input text-xs w-full" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-black/50 block mb-1">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input text-xs w-full">
            {OFFICER_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="btn-primary w-full !py-2.5 text-xs font-bold"
      >
        {isPending ? "Adding…" : "Add officer"}
      </button>
    </div>
  );
}
