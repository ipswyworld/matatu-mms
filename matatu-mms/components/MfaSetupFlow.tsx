"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2, Copy, Check, AlertTriangle } from "lucide-react";
import { enrollMfaAction, confirmMfaAction } from "@/lib/actions";

type Step = "loading" | "scan" | "confirm" | "backup-codes" | "error";

function ConfirmSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2" disabled={pending}>
      {pending ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} strokeWidth={2} />}
      {pending ? "Checking..." : "Confirm and enable"}
    </button>
  );
}

// Forced enrollment flow for ADMIN/SUPERADMIN accounts (see middleware.ts's
// mfaSetupRequired gate) — three steps: scan QR, confirm a live code, save
// backup codes. Each step is its own screen rather than a single long form
// since the backup codes step in particular needs the user's full attention
// (shown exactly once, never retrievable again).
export default function MfaSetupFlow() {
  const [step, setStep] = useState<Step>("loading");
  const [enrollment, setEnrollment] = useState<{ qrCodeDataUri: string; manualEntryKey: string } | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmState, confirmAction] = useFormState(confirmMfaAction, undefined);
  const [acknowledged, setAcknowledged] = useState(false);
  const router = useRouter();

  useEffect(() => {
    enrollMfaAction().then((result) => {
      if ("error" in result) {
        setEnrollError(result.error);
        setStep("error");
      } else {
        setEnrollment(result);
        setStep("scan");
      }
    });
  }, []);

  useEffect(() => {
    if (confirmState?.backupCodes) {
      setStep("backup-codes");
    }
  }, [confirmState]);

  if (step === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={28} className="animate-spin text-county-green" />
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-county-red">
          <AlertTriangle size={20} />
          <h2 className="text-lg font-black">Couldn't start setup</h2>
        </div>
        <p className="text-sm text-county-ink/70">{enrollError}</p>
        <button className="btn-primary w-full !py-3" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  if (step === "backup-codes" && confirmState?.backupCodes) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-county-ink">Save your backup codes</h2>
          <p className="text-sm text-county-ink/55 mt-2">
            Each code works once, if you ever lose access to your authenticator app. Store them somewhere
            safe — they won't be shown again.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 bg-county-cream border border-black/10 rounded-xl p-4 font-mono text-sm">
          {confirmState.backupCodes.map((code) => (
            <div key={code} className="text-county-ink font-semibold tracking-tight">{code}</div>
          ))}
        </div>

        <label className="flex items-start gap-2 text-xs font-semibold text-county-ink/70 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-black/20 text-county-green focus:ring-county-green/40"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          I've saved these backup codes somewhere safe.
        </label>

        <button
          type="button"
          className="btn-primary w-full !py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!acknowledged}
          onClick={() => router.push("/dashboard")}
        >
          Continue to dashboard
        </button>
      </div>
    );
  }

  if (step === "confirm" && enrollment) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-county-ink">Enter the code</h2>
          <p className="text-sm text-county-ink/55 mt-2">
            Type the 6-digit code your authenticator app is now showing for this account.
          </p>
        </div>

        <form action={confirmAction} className="space-y-4">
          <input
            className="input tracking-[0.3em] text-center text-lg font-bold"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            autoFocus
            required
          />

          {confirmState?.error && (
            <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
              {confirmState.error}
            </div>
          )}

          <ConfirmSubmitButton />
        </form>

        <button
          type="button"
          className="text-xs font-bold text-county-ink/50 hover:text-county-ink/80 hover:underline"
          onClick={() => setStep("scan")}
        >
          Back to QR code
        </button>
      </div>
    );
  }

  // step === "scan"
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl font-black tracking-tight text-county-ink">Set up two-factor authentication</h2>
        <p className="text-sm text-county-ink/55 mt-2">
          Admin accounts require an authenticator app (Google Authenticator, Authy, 1Password, etc.). Scan
          this QR code to add this account.
        </p>
      </div>

      <div className="flex justify-center bg-white border border-black/10 rounded-xl p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrollment!.qrCodeDataUri} alt="MFA enrollment QR code" width={200} height={200} />
      </div>

      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-county-ink/50 mb-1">
          Can't scan? Enter this key manually
        </div>
        <div className="flex items-center gap-2 bg-county-cream border border-black/10 rounded-lg px-3 py-2.5">
          <code className="flex-1 text-sm font-mono font-semibold text-county-ink tracking-wide break-all">
            {enrollment!.manualEntryKey}
          </code>
          <button
            type="button"
            className="shrink-0 text-county-green hover:text-county-green-deep"
            onClick={() => {
              navigator.clipboard.writeText(enrollment!.manualEntryKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            aria-label="Copy key"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <button type="button" className="btn-primary w-full !py-3 text-base" onClick={() => setStep("confirm")}>
        I've added it to my app
      </button>
    </div>
  );
}
