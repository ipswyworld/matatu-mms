"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search, CreditCard, ArrowRight } from "lucide-react";
import { publicLookupCaseAction, publicPayCaseAction } from "@/lib/actions";
import NairobiCrest from "@/components/NairobiCrest";
import NairobiPayBadge from "@/components/NairobiPayBadge";
import PublicFooter from "@/components/PublicFooter";

export default function PayFinePage() {
  const [reference, setReference] = useState("");
  const [caseData, setCaseData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleLookup = () => {
    if (!reference.trim()) {
      setError("Enter your case reference number.");
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
    <main className="min-h-screen bg-county-black text-white flex flex-col">
      <div className="flex-1 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <NairobiCrest size={52} className="mx-auto drop-shadow-lg" />
          <h1 className="text-xl font-extrabold tracking-tight text-white">Nairobi City County</h1>
          <p className="text-xs font-semibold text-county-yellow uppercase tracking-widest">Pay Traffic / Compliance Fine</p>
        </div>

        <div className="bg-white/[0.06] border border-white/10 p-6 rounded-2xl shadow-2xl space-y-4">
          <p className="text-xs text-white/60">
            Enter the case reference number given to you by the arresting officer (e.g. MMS-36898KDY541L). No account
            or login is needed.
          </p>

          {error && (
            <div className="bg-county-red/20 border border-county-red/40 text-red-200 text-xs p-3 rounded-lg font-semibold text-center">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="MMS-XXXXXXXXXXX"
              className="flex-1 bg-black/40 border border-white/15 rounded-lg px-3.5 py-2 text-sm text-white placeholder-white/30 font-mono focus:outline-none focus:border-county-green"
            />
            <button onClick={handleLookup} disabled={isPending} className="btn-primary !px-4 text-xs font-bold shrink-0 flex items-center gap-1.5">
              <Search size={13} strokeWidth={2} />
              {isPending ? "..." : "Look Up"}
            </button>
          </div>

          {caseData && (
            <div className="space-y-3 pt-3 border-t border-white/10">
              <div className="text-sm space-y-1.5">
                <div className="flex justify-between"><span className="text-white/50">Plate Number</span><span className="font-mono font-bold">{caseData.regNumber}</span></div>
                <div className="flex justify-between"><span className="text-white/50">Offence</span><span className="font-bold">{caseData.offenceName}</span></div>
                <div className="flex justify-between"><span className="text-white/50">Fine Amount</span><span className="font-bold">KES {caseData.fineAmountKes?.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-white/50">Status</span><span className="font-bold text-county-yellow">{caseData.status}</span></div>
              </div>

              {caseData.status === "ARRESTED" && (
                <>
                  <button onClick={handlePay} disabled={isPending} className="btn-primary w-full font-bold flex items-center justify-center gap-2">
                    <CreditCard size={15} strokeWidth={2} />
                    {isPending ? "Processing..." : `Pay KES ${caseData.fineAmountKes?.toLocaleString()} via NairobiPay`}
                  </button>
                  <div className="flex justify-end"><NairobiPayBadge /></div>
                  <p className="text-[10px] text-white/40">
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

          <div className="text-center text-xs text-white/50 pt-2 border-t border-white/10">
            <Link href="/login" className="font-bold text-county-yellow hover:underline inline-flex items-center gap-1">
              County staff sign in
              <ArrowRight size={11} strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </div>
      </div>
      <PublicFooter dark />
    </main>
  );
}
