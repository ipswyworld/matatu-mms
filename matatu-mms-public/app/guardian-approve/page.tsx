"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, ShieldCheck, ArrowLeft } from "lucide-react";
import PublicFooter from "@/components/PublicFooter";

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

// No login required — a guardian has no account of their own. The token
// is the only credential; GET first (just shows the two names, doesn't
// consume the token) so a link-scanner or accidental double-open can't
// silently burn a one-time approval before the guardian actually taps
// Approve. See backend/app/routes/public_updates.py.
export default function GuardianApprovePage() {
  return (
    <Suspense fallback={null}>
      <GuardianApproveForm />
    </Suspense>
  );
}

type State = "loading" | "ready" | "approving" | "done" | "error";

function GuardianApproveForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [state, setState] = useState<State>("loading");
  const [info, setInfo] = useState<{ minorName: string; guardianName: string } | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("This link is missing its approval token.");
      return;
    }
    fetch(`${API_BASE_URL}/api/public/guardian-approve?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || "This approval link is invalid or has expired.");
        return res.json();
      })
      .then((data) => {
        setInfo({ minorName: data.minorName, guardianName: data.guardianName });
        setState("ready");
      })
      .catch((e) => {
        setState("error");
        setMessage(e.message || "This approval link is invalid or has expired.");
      });
  }, [token]);

  const approve = async () => {
    setState("approving");
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/guardian-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Couldn't approve this account right now.");
      setMessage(data.message);
      setState("done");
    } catch (e: any) {
      setState("error");
      setMessage(e.message || "Couldn't approve this account right now.");
    }
  };

  return (
    <main className="min-h-screen bg-county-cream flex flex-col">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="mx-auto object-contain drop-shadow" priority />
            <h1 className="text-2xl font-black tracking-tight text-county-ink">Guardian Approval</h1>
          </div>

          <div className="card p-6 space-y-4">
            {state === "loading" && (
              <div className="h-20 rounded-lg bg-county-cream animate-pulse" />
            )}

            {state === "error" && (
              <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3.5 py-3">
                {message}
              </div>
            )}

            {(state === "ready" || state === "approving") && info && (
              <>
                <div className="flex items-start gap-3 rounded-lg border border-county-ink/10 bg-county-cream/60 p-3.5">
                  <ShieldCheck size={20} strokeWidth={2} className="text-county-green shrink-0 mt-0.5" />
                  <p className="text-sm text-county-ink/80 leading-relaxed">
                    <span className="font-bold">{info.minorName}</span> used this phone number to register a Mji-Move passenger account, listing you (<span className="font-bold">{info.guardianName}</span>) as their guardian.
                  </p>
                </div>
                <p className="text-xs text-county-ink/55">
                  Approving lets them sign in and book seats. If you don't recognize this request, you can ignore it and the account will stay unusable.
                </p>
                <button
                  type="button"
                  onClick={approve}
                  disabled={state === "approving"}
                  className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2"
                >
                  {state === "approving" ? "Approving..." : "Approve this account"}
                </button>
              </>
            )}

            {state === "done" && (
              <div className="flex items-start gap-3 rounded-lg border border-county-green/30 bg-county-green/10 p-3.5">
                <CheckCircle2 size={20} strokeWidth={2} className="text-county-green shrink-0 mt-0.5" />
                <p className="text-sm text-county-ink/80 leading-relaxed">{message}</p>
              </div>
            )}
          </div>

          <div className="text-center">
            <Link href="/" className="text-xs font-extrabold text-county-green hover:underline inline-flex items-center gap-1">
              <ArrowLeft size={12} strokeWidth={2.5} />
              Back to Sign in
            </Link>
          </div>
        </div>
      </div>
      <PublicFooter />
    </main>
  );
}
