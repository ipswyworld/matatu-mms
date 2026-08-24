"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { FeatureFlag } from "@/lib/types";
import { createFeatureFlagAction, toggleFeatureFlagAction, deleteFeatureFlagAction } from "@/lib/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary text-xs px-4 py-2">
      {pending ? "Adding…" : "Add Flag"}
    </button>
  );
}

function FlagRow({ flag }: { flag: FeatureFlag }) {
  const [enabled, setEnabled] = useState(flag.enabled);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !enabled;
    setEnabled(next); // optimistic — routine toggle, no confirmation needed (A.4 #1)
    startTransition(async () => {
      const result = await toggleFeatureFlagAction(flag.key, next);
      if (result.error) {
        setEnabled(!next);
        setError(result.error);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteFeatureFlagAction(flag.key);
      if (result.error) {
        setError(result.error);
        setConfirmDelete(false);
        return;
      }
      setDeleted(true);
    });
  }

  if (deleted) return null;

  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-black/10 bg-black/[0.01]">
      <div className="min-w-0">
        <span className="font-mono text-xs font-bold text-county-black">{flag.key}</span>
        {flag.description && <p className="text-[11px] text-black/50 mt-0.5">{flag.description}</p>}
        {error && <p className="text-[11px] text-county-red font-semibold mt-0.5">{error}</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          disabled={isPending}
          className={`relative w-10 h-6 rounded-full transition-colors ${enabled ? "bg-county-green" : "bg-black/15"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </button>
        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={handleDelete} disabled={isPending} className="text-[10px] font-bold text-white bg-county-red rounded px-2 py-1">
              {isPending ? "…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="text-[10px] font-bold text-black/50 rounded px-2 py-1 hover:bg-black/5">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-black/30 hover:text-county-red p-1" aria-label="Delete flag">
            <Trash2 size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function FeatureFlagsPanel({ flags }: { flags: FeatureFlag[] }) {
  const [state, formAction] = useFormState(createFeatureFlagAction, undefined);

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-sm text-county-black">Feature Flags</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Toggle capabilities per environment without a redeploy. Every create/toggle/delete is recorded in the
          Audit Trail below.
        </p>
      </div>

      {flags.length === 0 ? (
        <p className="text-xs text-black/40 italic">No feature flags defined yet.</p>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => (
            <FlagRow key={f.key} flag={f} />
          ))}
        </div>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2 pt-2 border-t border-black/5">
        <div className="flex-1 min-w-[160px]">
          <label className="label">Key</label>
          <input name="key" required pattern="[a-z][a-z0-9_]{2,63}" title="lowercase snake_case, e.g. impersonation_enabled" placeholder="impersonation_enabled" className="input text-xs" />
        </div>
        <div className="flex-[2] min-w-[200px]">
          <label className="label">Description (optional)</label>
          <input name="description" placeholder="What this flag controls" className="input text-xs" />
        </div>
        <SubmitButton />
      </form>
      {state?.error && <p className="text-xs text-county-red font-semibold">{state.error}</p>}
    </div>
  );
}
