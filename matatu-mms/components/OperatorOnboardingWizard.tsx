"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sacco } from "@/lib/types";
import { submitApplicationAction } from "@/lib/actions";
import SaccoDocumentUploadRow from "./SaccoDocumentUploadRow";
import SaccoOfficialsForm from "./SaccoOfficialsForm";

function parseOfficials(json?: string) {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function missingItems(sacco: Sacco): string[] {
  const missing: string[] = [];
  if (!sacco.docRegistrationCert) missing.push("Registration Certificate");
  if (!sacco.docRoadServiceLicense) missing.push("Road Service License");
  if (!sacco.docCountyPermit) missing.push("Permit from County");
  if (!sacco.docSingleBusinessPermit) missing.push("Single Business Permit");
  if (!sacco.docTaxComplianceCert) missing.push("Tax Compliance Certificate");
  if (sacco.saccoType === "NEW" && !sacco.docLetterNoObjection) missing.push("Letter of No Objection");
  if (!sacco.docOfficialsContacts) missing.push("Bonafide Officials Contacts");
  return missing;
}

function StageTracker({ sacco }: { sacco: Sacco }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="p-3 rounded-lg border border-white/15 bg-black/20 text-xs space-y-1">
        <div className="flex justify-between items-center">
          <span className="font-extrabold text-white">Stage 1 · Director of Mobility</span>
          <span
            className={`badge font-extrabold ${
              sacco.directorMobilityStatus === "APPROVED"
                ? "bg-county-green/20 text-county-green"
                : sacco.directorMobilityStatus === "REJECTED"
                ? "bg-county-red/20 text-county-red"
                : "bg-county-yellow/20 text-county-yellow"
            }`}
          >
            {sacco.directorMobilityStatus || "PENDING"}
          </span>
        </div>
        {sacco.directorMobilityReason && <p className="text-white/60">Reason: {sacco.directorMobilityReason}</p>}
      </div>
      <div className="p-3 rounded-lg border border-white/15 bg-black/20 text-xs space-y-1">
        <div className="flex justify-between items-center">
          <span className="font-extrabold text-white">Stage 2 · Chief Officer (Final)</span>
          <span
            className={`badge font-extrabold ${
              sacco.chiefOfficerStatus === "APPROVED"
                ? "bg-county-green/20 text-county-green"
                : sacco.chiefOfficerStatus === "REJECTED"
                ? "bg-county-red/20 text-county-red"
                : "bg-county-yellow/20 text-county-yellow"
            }`}
          >
            {sacco.chiefOfficerStatus || "PENDING"}
          </span>
        </div>
        {sacco.chiefOfficerReason && <p className="text-white/60">Reason: {sacco.chiefOfficerReason}</p>}
      </div>
    </div>
  );
}

export default function OperatorOnboardingWizard({ sacco }: { sacco: Sacco }) {
  const wasRejected = sacco.status === "REJECTED";
  const isSubmitted = Boolean(sacco.applicationSubmittedAt) && !wasRejected;
  const [editingAfterRejection, setEditingAfterRejection] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const officials = parseOfficials(sacco.docOfficialsContacts);

  const showWizard = !isSubmitted && (!wasRejected || editingAfterRejection);

  if (isSubmitted) {
    return (
      <div className="space-y-4">
        <div className="bg-county-green/10 border border-county-green/30 text-county-green p-4 rounded-xl font-bold text-center">
          Application submitted — awaiting county verification.
        </div>
        <StageTracker sacco={sacco} />
        <p className="text-xs text-white/50 text-center">
          You'll be able to access your full Operator Dashboard automatically once both stages approve. Refresh this
          page any time to check your status.
        </p>
      </div>
    );
  }

  if (wasRejected && !editingAfterRejection) {
    return (
      <div className="space-y-4">
        <div className="bg-county-red/10 border border-county-red/30 text-county-red p-4 rounded-xl space-y-2">
          <div className="font-bold text-center">Your application was rejected</div>
          <p className="text-sm text-center">{sacco.rejectionReason || "No reason was recorded."}</p>
        </div>
        <button onClick={() => setEditingAfterRejection(true)} className="btn-primary w-full font-bold">
          Fix & Resubmit Application
        </button>
      </div>
    );
  }

  const steps = [
    { n: 1, label: "Documents" },
    { n: 2, label: "Bonafide Officials" },
    { n: 3, label: "Review & Submit" },
  ];

  const handleSubmit = () => {
    const missing = missingItems(sacco);
    if (missing.length > 0) {
      setError(`Still missing: ${missing.join(", ")}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitApplicationAction(sacco.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      window.location.reload();
    });
  };

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2 flex-1">
            <button
              onClick={() => setStep(s.n)}
              className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${
                step === s.n ? "bg-county-yellow text-county-green-deep" : "bg-white/10 text-white/60"
              }`}
            >
              {s.n}
            </button>
            <span className={`text-xs font-bold ${step === s.n ? "text-white" : "text-white/40"}`}>{s.label}</span>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-white/10" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-county-red/20 border border-county-red/40 text-red-200 text-xs p-3 rounded-lg font-semibold">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-2.5">
          <p className="text-xs text-white/60">
            Upload each mandatory document (PDF, JPG, or PNG). {sacco.saccoType === "NEW" && "As a new operator, a Letter of No Objection is required before your Road Service License is accepted."}
          </p>
          <div className="bg-white rounded-xl p-3 space-y-2">
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="registrationCert" label="1. Registration Certificate" currentPath={sacco.docRegistrationCert} />
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="roadServiceLicense" label="2. Road Service License (RSL)" currentPath={sacco.docRoadServiceLicense} />
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="countyPermit" label="3. Permit from County" currentPath={sacco.docCountyPermit} />
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="singleBusinessPermit" label="4. Single Business Permit (SBP)" currentPath={sacco.docSingleBusinessPermit} />
            <SaccoDocumentUploadRow saccoId={sacco.id} docType="taxComplianceCert" label="5. Tax Compliance Certificate" currentPath={sacco.docTaxComplianceCert} />
            {sacco.saccoType === "NEW" && (
              <SaccoDocumentUploadRow saccoId={sacco.id} docType="letterNoObjection" label="6. Letter of No Objection" currentPath={sacco.docLetterNoObjection} />
            )}
          </div>
          <button onClick={() => setStep(2)} className="btn-primary w-full font-bold mt-2">Next: Bonafide Officials →</button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2.5">
          <p className="text-xs text-white/60">Chairperson, Secretary, and Treasurer contact details for your Sacco.</p>
          <div className="bg-white rounded-xl p-3">
            <SaccoOfficialsForm saccoId={sacco.id} officials={officials} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="btn-secondary flex-1 font-bold">← Back</button>
            <button onClick={() => setStep(3)} className="btn-primary flex-1 font-bold">Next: Review →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <h4 className="font-bold text-sm text-white">Review Before Submitting</h4>
          {missingItems(sacco).length === 0 ? (
            <div className="bg-county-green/10 border border-county-green/30 text-county-green text-xs p-3 rounded-lg font-semibold">
              Everything's in place. Submit when ready — you won't be able to edit while under review.
            </div>
          ) : (
            <div className="bg-county-yellow/10 border border-county-yellow/30 text-county-yellow text-xs p-3 rounded-lg font-semibold">
              Still missing: {missingItems(sacco).join(", ")}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="btn-secondary flex-1 font-bold">← Back to edit</button>
            <button onClick={handleSubmit} disabled={isPending} className="btn-primary flex-1 font-bold">
              {isPending ? "Submitting..." : "Submit Application for Review"}
            </button>
          </div>
        </div>
      )}

      <div className="text-center text-xs text-white/40 pt-2 border-t border-white/10">
        <Link href="/login" className="hover:underline">Sign out and come back later →</Link>
      </div>
    </div>
  );
}
