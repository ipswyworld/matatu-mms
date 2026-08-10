"use client";

import { useState, useTransition } from "react";
import { submitLicenseRenewalAction } from "@/lib/actions";
import { SaccoLicenseStatus } from "@/lib/types";
import NairobiPayBadge from "./NairobiPayBadge";

export default function LicenseRenewalButton({ saccoId, licenseStatus }: { saccoId: string; licenseStatus: SaccoLicenseStatus }) {
  const [status, setStatus] = useState(licenseStatus);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitLicenseRenewalAction(saccoId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStatus("RENEWAL_SUBMITTED");
    });
  };

  if (status === "ACTIVE") {
    return (
      <div className="p-3 rounded-xl bg-county-green/10 border border-county-green/30 text-xs">
        <div className="font-extrabold text-county-green">Monthly Permit Current</div>
        <p className="text-black/60 mt-1">No renewal action needed right now.</p>
      </div>
    );
  }

  if (status === "RENEWAL_SUBMITTED") {
    return (
      <div className="p-3 rounded-xl bg-county-blue/10 border border-county-blue/30 text-xs">
        <div className="font-extrabold text-county-blue">Renewal Payment Submitted</div>
        <p className="text-black/60 mt-1">Awaiting county approval — you&apos;ll be notified once it clears.</p>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-xl bg-county-yellow/10 border border-county-yellow/30 text-xs space-y-2">
      <div className="font-extrabold text-yellow-800">Monthly Permit Renewal Due</div>
      <p className="text-black/70">Operating permits must be renewed monthly between the 25th and 5th.</p>
      {error && <p className="text-county-red font-semibold">{error}</p>}
      <button
        disabled={isPending}
        onClick={handleSubmit}
        className="btn-primary w-full !py-2 text-xs font-bold"
      >
        {isPending ? "Submitting..." : "Pay Monthly Permit via NairobiPay"}
      </button>
      <div className="flex justify-end"><NairobiPayBadge /></div>
    </div>
  );
}
