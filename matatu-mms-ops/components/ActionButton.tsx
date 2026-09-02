"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, KeyRound, Loader2, ShieldAlert, X } from "lucide-react";
import { ACTION_CLASS_META, actionFor, reversibilityText } from "@/lib/opsActions";
import { reauthenticateAction } from "@/lib/actions";

interface ActionButtonProps {
  /** Key into OPS_ACTIONS — carries the safety metadata. */
  actionId: string;
  /** What is being acted on, shown verbatim in the confirmation. */
  target: string;
  /** Runs after confirmation. `reason` is guaranteed non-empty for
   *  Elevated and Critical actions, and empty for Routine ones.
   *  `reauthToken` is present only for Critical actions. */
  onConfirm: (reason: string, reauthToken?: string) => Promise<{ error?: string } | void>;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  /** Extra context shown in the dialog, e.g. current vs. new value. */
  preview?: React.ReactNode;
}

/**
 * The single gate every ops action passes through (Ops Console Rebuild
 * Spec §4).
 *
 * Confirmation, reason capture, blast-radius disclosure, and reversibility
 * are driven by the action's descriptor rather than by whatever the call
 * site remembered to pass, which is what makes the safety model structural
 * instead of a convention.
 */
export default function ActionButton({
  actionId,
  target,
  onConfirm,
  children,
  className = "",
  disabled = false,
  preview,
}: ActionButtonProps) {
  const descriptor = actionFor(actionId);
  const meta = ACTION_CLASS_META[descriptor.actionClass];

  if (descriptor.inlineApply) {
    // Loud, because this is a wiring mistake rather than a runtime
    // condition: an inlineApply action is confirmed by its own control, so
    // routing it through the modal would contradict its own declaration.
    throw new Error(
      `Action ${actionId} is declared inlineApply — render its own control instead of <ActionButton>.`,
    );
  }

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes, and focus moves into the dialog — this console is used
  // under time pressure, so keyboard-only operation has to work.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("textarea, input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const reasonOk = !meta.requiresReason || reason.trim().length >= 3;
  const typedOk = !meta.requiresTypedConfirm || typed.trim() === target.trim();
  const reauthOk = !meta.requiresReauth || password.length > 0;
  const canSubmit = reasonOk && typedOk && reauthOk && !pending;

  function reset() {
    setReason("");
    setTyped("");
    setPassword("");
    setMfaCode("");
    setError(null);
  }

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      let reauthToken: string | undefined;

      // Step-up authentication for Critical actions. Done here rather than
      // in each action so no Critical action can ship without it, and the
      // password never leaves this dialog — it is exchanged for a
      // short-lived token immediately.
      if (meta.requiresReauth) {
        const auth = await reauthenticateAction(password, mfaCode.trim() || undefined);
        if (auth.error || !auth.reauthToken) {
          setError(auth.error || "Re-authentication failed.");
          setPassword("");
          return;
        }
        reauthToken = auth.reauthToken;
      }

      const result = await onConfirm(reason.trim(), reauthToken);
      if (result && "error" in result && result.error) {
        setError(result.error);
        setPassword("");
        return;
      }
      setOpen(false);
      reset();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className={
          className ||
          "text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 disabled:opacity-40 transition-colors"
        }
      >
        {pending ? <Loader2 size={12} className="animate-spin inline" /> : children || descriptor.label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div ref={dialogRef} className="w-full max-w-md bg-white rounded-xl shadow-xl border border-black/10 overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-black/10">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`badge text-[9px] font-extrabold ${meta.chip}`}>{meta.label.toUpperCase()}</span>
                  {descriptor.reversible === false && (
                    <span className="badge text-[9px] font-extrabold bg-county-red/10 text-county-red inline-flex items-center gap-1">
                      <ShieldAlert size={10} /> NOT REVERSIBLE
                    </span>
                  )}
                </div>
                <h3 className="font-black text-sm text-county-ink mt-1.5">{descriptor.label}</h3>
                <p className="text-[11px] text-black/50 mt-0.5 break-words">{target}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-black/30 hover:text-black/60 shrink-0">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {descriptor.detail && <p className="text-xs text-black/70 leading-relaxed">{descriptor.detail}</p>}

              <div className="rounded-lg bg-black/[0.02] border border-black/10 p-3 space-y-1.5">
                <div className="text-[11px]">
                  <span className="font-bold text-county-ink">Affects: </span>
                  <span className="text-black/70">{descriptor.affectedScope}</span>
                </div>
                <div className="text-[11px]">
                  <span className="font-bold text-county-ink">Undo: </span>
                  <span className="text-black/70">{reversibilityText(descriptor)}</span>
                </div>
              </div>

              {preview && <div className="text-[11px]">{preview}</div>}

              {meta.requiresReason && (
                <div>
                  <label className="label" htmlFor={`reason-${actionId}`}>
                    Reason <span className="text-black/40 font-normal">(recorded in the audit trail)</span>
                  </label>
                  <textarea
                    id={`reason-${actionId}`}
                    className="input min-h-[64px] text-xs"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this being done right now?"
                  />
                </div>
              )}

              {meta.requiresTypedConfirm && (
                <div>
                  <label className="label" htmlFor={`typed-${actionId}`}>
                    Type <span className="font-mono text-county-red">{target}</span> to confirm
                  </label>
                  <input
                    id={`typed-${actionId}`}
                    className="input text-xs font-mono"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              )}

              {meta.requiresReauth && (
                <div className="rounded-lg border border-county-red/25 bg-county-red/[0.03] p-3 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-county-red">
                    <KeyRound size={12} />
                    Confirm it&apos;s you
                  </div>
                  <p className="text-[10px] text-black/55 leading-relaxed">
                    Critical actions re-check your password, so an unattended session cannot fire one.
                  </p>
                  <div>
                    <label className="label" htmlFor={`pw-${actionId}`}>
                      Password
                    </label>
                    <input
                      id={`pw-${actionId}`}
                      type="password"
                      className="input text-xs"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      placeholder="••••••••"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor={`mfa-${actionId}`}>
                      Authenticator code <span className="text-black/40 font-normal">(if enrolled)</span>
                    </label>
                    <input
                      id={`mfa-${actionId}`}
                      className="input text-xs font-mono"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      placeholder="123456"
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="text-xs text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2 font-semibold flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-black/[0.02] border-t border-black/10">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs font-bold px-3 py-2 rounded-lg hover:bg-black/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="text-xs font-bold px-3.5 py-2 rounded-lg bg-county-green text-white hover:bg-county-green-dark disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
              >
                {pending && <Loader2 size={12} className="animate-spin" />}
                {descriptor.label}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
