"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { FeatureFlag } from "@/lib/types";
import { createFeatureFlagAction, toggleFeatureFlagAction, deleteFeatureFlagAction, scheduleFeatureFlagAction } from "@/lib/actions";
import ActionButton from "./ActionButton";

/** "2026-09-25T14:30" (datetime-local's value format) from an ISO string, in
 *  the browser's local time zone — matches what the input will hand back. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [enableAt, setEnableAt] = useState(toLocalInputValue(flag.scheduledEnableAt));
  const [disableAt, setDisableAt] = useState(toLocalInputValue(flag.scheduledDisableAt));
  const [scheduleSaved, setScheduleSaved] = useState(false);

  function saveSchedule() {
    startTransition(async () => {
      setScheduleSaved(false);
      const result = await scheduleFeatureFlagAction(
        flag.key,
        enableAt ? new Date(enableAt).toISOString() : null,
        disableAt ? new Date(disableAt).toISOString() : null,
      );
      if (result.error) setError(result.error);
      else setScheduleSaved(true);
    });
  }

  // Applied inline rather than through <ActionButton>: the switch is its
  // own confirmation (see ActionDescriptor.inlineApply). Optimistic, with
  // a rollback if the write fails.
  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await toggleFeatureFlagAction(flag.key, next);
      if (result.error) {
        setEnabled(!next);
        setError(result.error);
      }
    });
  }

  if (deleted) return null;

  return (
    <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-xs font-bold text-county-black">{flag.key}</span>
          {flag.description && <p className="text-[11px] text-black/50 mt-0.5">{flag.description}</p>}
          {(flag.scheduledEnableAt || flag.scheduledDisableAt) && (
            <p className="text-[10px] text-amber-700 mt-0.5">
              {flag.scheduledEnableAt && `Enables ${new Date(flag.scheduledEnableAt).toLocaleString()}`}
              {flag.scheduledEnableAt && flag.scheduledDisableAt && " · "}
              {flag.scheduledDisableAt && `Disables ${new Date(flag.scheduledDisableAt).toLocaleString()}`}
            </p>
          )}
          {error && <p className="text-[11px] text-county-red font-semibold mt-0.5">{error}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`Toggle ${flag.key}`}
            onClick={handleToggle}
            disabled={isPending}
            className={`relative w-10 h-6 rounded-full transition-colors ${enabled ? "bg-county-green" : "bg-black/15"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
          <ActionButton
            actionId="flag.delete"
            target={flag.key}
            onConfirm={async (reason) => {
              const result = await deleteFeatureFlagAction(flag.key);
              if (result.error) return result;
              setDeleted(true);
              return {};
            }}
            className="text-black/30 hover:text-county-red p-1"
          >
            <Trash2 size={14} strokeWidth={2} />
          </ActionButton>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-black/5">
        <div>
          <label className="label text-[10px]">Schedule enable</label>
          <input type="datetime-local" value={enableAt} onChange={(e) => { setEnableAt(e.target.value); setScheduleSaved(false); }} className="input text-[11px] py-1" />
        </div>
        <div>
          <label className="label text-[10px]">Schedule disable</label>
          <input type="datetime-local" value={disableAt} onChange={(e) => { setDisableAt(e.target.value); setScheduleSaved(false); }} className="input text-[11px] py-1" />
        </div>
        <button
          type="button"
          onClick={saveSchedule}
          disabled={isPending}
          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 disabled:opacity-40 transition-colors"
        >
          {scheduleSaved ? "Saved" : "Save schedule"}
        </button>
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
          Toggle capabilities per environment without a redeploy. Every create, toggle, and delete is recorded in
          the Audit tab.
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
