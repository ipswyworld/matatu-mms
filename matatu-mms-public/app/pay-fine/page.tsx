"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Search, CreditCard, ArrowLeft } from "lucide-react";
import { publicLookupCaseAction, publicPayCaseAction } from "@/lib/actions";
import AuthSkyline from "@/components/AuthSkyline";
import NairobiPayBadge from "@/components/NairobiPayBadge";
import PublicFooter from "@/components/PublicFooter";

export default function PayFinePage() {
  const [reference, setReference] = useState("");
  const [caseData, setCaseData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleLookup = () => {
    if (!reference.trim()) {
      setError("Enter your phone number or case reference.");
      return;
    }
    setError(null);
    setCaseData(null);
    startTransition(async () => {
      const result = await publicLookupCaseAction(reference);
      if (result.error) { setError(result.error); return; }
      setCaseData(result.caseData);
    });
  };

  const handlePay = () => {
    setError(null);
    startTransition(async () => {
      const result = await publicPayCaseAction(reference);
      if (result.error) { setError(result.error); return; }
      setCaseData(result.caseData);
    });
  };

  return (
    <main className="relative min-h-screen bg-county-cream flex flex-col overflow-hidden">
      {/* Spans the whole page (form area + footer), not just the card's
          slice, so it reads all the way down to the footer links — same
          treatment as register/forgot-password/reset-password. */}
      <AuthSkyline heightClassName="h-[70vh]" />
      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="mx-auto object-contain drop-shadow" priority />
            <h1 className="text-2xl font-black tracking-tight text-county-ink">Pay a Traffic / Compliance Fine</h1>
            <p className="text-sm text-county-ink/55">
              Enter your phone number or the case reference given to you by the arresting officer (e.g. MMS-36898KDY541L). No account or login is needed.
            </p>
          </div>

          <div className="card p-6 space-y-4 auth-card-enter">
            {error && (
              <div className="text-sm text-county-red bg-county-red/10 border border-county-red/30 rounded-lg px-3 py-2.5 font-semibold">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Phone number or MMS-XXXXXXXXXXX"
                className="input flex-1 font-mono"
              />
              <button onClick={handleLookup} disabled={isPending} className="btn-primary !px-4 text-xs font-bold shrink-0 flex items-center gap-1.5">
                <Search size={13} strokeWidth={2} />
                {isPending ? "..." : "Look Up"}
              </button>
            </div>

            {caseData && (
              <div className="space-y-3 pt-3 border-t border-black/5">
                <div className="text-sm space-y-1.5">
                  <div className="flex justify-between"><span className="text-county-ink/50">Plate Number</span><span className="font-mono font-bold text-county-ink">{caseData.regNumber}</span></div>
                  <div className="flex justify-between"><span className="text-county-ink/50">Offence</span><span className="font-bold text-county-ink">{caseData.offenceName}</span></div>
                  <div className="flex justify-between"><span className="text-county-ink/50">Fine Amount</span><span className="font-bold text-county-ink">KES {caseData.fineAmountKes?.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-county-ink/50">Status</span><span className="font-bold text-county-green">{caseData.status}</span></div>
                </div>

                {caseData.status === "ARRESTED" && (
                  <>
                    <button onClick={handlePay} disabled={isPending} className="btn-primary w-full font-bold flex items-center justify-center gap-2">
                      <CreditCard size={15} strokeWidth={2} />
                      {isPending ? "Processing..." : `Pay KES ${caseData.fineAmountKes?.toLocaleString()} via NairobiPay`}
                    </button>
                    <div className="flex justify-end"><NairobiPayBadge /></div>
                    <p className="text-[10px] text-county-ink/45">
                      Records the payment on our end immediately for now. Real-time gateway confirmation via NairobiPay
                      is pending an API key. Once paid, the releasing officer finalizes release of your vehicle.
                    </p>
                  </>
                )}
                {caseData.status === "PAID" && (
                  <div className="bg-county-blue/10 border border-county-blue/30 text-county-blue text-xs p-3 rounded-lg font-semibold">
                    Payment received. Awaiting the releasing officer to finalize release.
                  </div>
                )}
                {caseData.status === "RELEASED" && (
                  <div className="bg-county-green/10 border border-county-green/30 text-county-green text-xs p-3 rounded-lg font-semibold">
                    Fine paid and vehicle released.
                  </div>
                )}
                {caseData.status === "WAIVED" && (
                  <div className="bg-county-green/10 border border-county-green/30 text-county-green text-xs p-3 rounded-lg font-semibold">
                    This fine has been waived by the county.
                  </div>
                )}
                {caseData.status === "DISPUTED" && (
                  <div className="bg-county-yellow/10 border border-county-yellow/30 text-yellow-700 text-xs p-3 rounded-lg font-semibold">
                    This case is under dispute review.
                  </div>
                )}
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
      <PublicFooter transparent />
    </main>
  );
}
