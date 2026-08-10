"use client";

import { useState } from "react";
import { Sacco, Role } from "@/lib/types";
import { decideDirectorStageAction, decideChiefOfficerStageAction } from "@/lib/actions";
import VerificationStageControl from "./VerificationStageControl";

const PUBLIC_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";

function parseOfficials(json?: string) {
  if (!json) return null;
  try {
    return JSON.parse(json) as {
      chairpersonName: string; chairpersonPhone: string;
      secretaryName: string; secretaryPhone: string;
      treasurerName: string; treasurerPhone: string;
    };
  } catch {
    return null;
  }
}

function DocRow({ label, path }: { label: string; path?: string }) {
  return (
    <div className="p-2.5 rounded-lg border border-black/10 bg-black/[0.01] flex justify-between items-center text-xs">
      <div className="min-w-0">
        <span className="font-bold text-county-black">{label}:</span>{" "}
        {path ? (
          <a href={`${PUBLIC_BACKEND_URL}${path}`} target="_blank" className="text-county-blue hover:underline font-mono text-[11px]">
            View document
          </a>
        ) : (
          <span className="font-mono text-[11px] text-black/40">Not yet uploaded</span>
        )}
      </div>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${path ? "text-county-green bg-county-green/10" : "text-yellow-800 bg-county-yellow/20"}`}>
        {path ? "DOCUMENT OK" : "MISSING"}
      </span>
    </div>
  );
}

export default function SaccoVerificationCard({
  sacco,
  primaryRouteName,
  vehicleCount,
  viewerRole,
}: {
  sacco: Sacco;
  primaryRouteName: string;
  vehicleCount: number;
  viewerRole: Role;
}) {
  const [showDocs, setShowDocs] = useState(false);
  const officials = parseOfficials(sacco.docOfficialsContacts);
  const canDecideStage1 = viewerRole === "ADMIN" || viewerRole === "DIRECTOR_MOBILITY";
  const canDecideStage2 = viewerRole === "ADMIN" || viewerRole === "CHIEF_OFFICER";

  const requiredDocs: [string, string | undefined][] = [
    ["Registration Certificate", sacco.docRegistrationCert],
    ["Road Service License (RSL)", sacco.docRoadServiceLicense],
    ["Permit from County", sacco.docCountyPermit],
    ["Single Business Permit (SBP)", sacco.docSingleBusinessPermit],
    ["Tax Compliance Certificate", sacco.docTaxComplianceCert],
    ...(sacco.saccoType === "NEW"
      ? ([["Letter of No Objection", sacco.docLetterNoObjection]] as [string, string | undefined][])
      : []),
  ];
  const uploadedCount = requiredDocs.filter(([, path]) => Boolean(path)).length;
  const allDocsUploaded = uploadedCount === requiredDocs.length;

  const overallStatus =
    sacco.chiefOfficerStatus === "APPROVED"
      ? "ACTIVE"
      : sacco.status === "REJECTED"
      ? "REJECTED"
      : "PENDING_VERIFICATION";

  return (
    <div className="card p-6 space-y-4 border border-black/10">
      <div className="flex flex-wrap justify-between items-start gap-4 border-b border-black/5 pb-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h4 className="text-xl font-extrabold text-county-black">{sacco.name}</h4>
            <span
              className={`badge font-extrabold ${
                overallStatus === "ACTIVE"
                  ? "bg-county-green/10 text-county-green"
                  : overallStatus === "REJECTED"
                  ? "bg-county-red/10 text-county-red"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {overallStatus === "ACTIVE" ? "LICENSED & APPROVED" : overallStatus.replace("_", " ")}
            </span>
            <span className="badge bg-county-blue/10 text-county-blue font-bold text-[10px]">
              {sacco.saccoType === "NEW" ? "NEW APPLICANT" : "EXISTING OPERATOR"}
            </span>
            {overallStatus === "PENDING_VERIFICATION" && (
              <span
                className={`badge font-bold text-[10px] ${
                  sacco.applicationSubmittedAt ? "bg-county-blue/10 text-county-blue" : "bg-black/10 text-black/50"
                }`}
              >
                {sacco.applicationSubmittedAt ? "APPLICATION SUBMITTED" : "DRAFT · NOT YET SUBMITTED"}
              </span>
            )}
          </div>
          <p className="text-xs text-black/60 mt-1">
            Primary Route Corridor: <strong className="text-county-black">{primaryRouteName}</strong> · Registered Fleet: <strong>{vehicleCount} Matatus</strong>
            {sacco.createdAt && <> · Applied {new Date(sacco.createdAt).toLocaleDateString()}</>}
          </p>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowDocs((v) => !v)}
          className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border border-black/10 bg-black/[0.01] hover:bg-black/[0.03] transition-colors text-left"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-extrabold text-county-black">Certificates & Bonafide Officials</span>
            <span
              className={`badge font-bold text-[10px] ${
                allDocsUploaded ? "bg-county-green/10 text-county-green" : "bg-county-yellow/20 text-yellow-800"
              }`}
            >
              {uploadedCount}/{requiredDocs.length} documents
            </span>
            <span
              className={`badge font-bold text-[10px] ${
                officials ? "bg-county-green/10 text-county-green" : "bg-county-yellow/20 text-yellow-800"
              }`}
            >
              Officials {officials ? "provided" : "missing"}
            </span>
          </div>
          <span className={`text-black/40 text-xs transition-transform ${showDocs ? "rotate-180" : ""}`}>▾</span>
        </button>

        {showDocs && (
          <div className="mt-3 space-y-2">
            <h5 className="text-xs font-extrabold text-black/70 uppercase tracking-wider">Mandatory Upload Verification</h5>
            <DocRow label="1. Registration Certificate" path={sacco.docRegistrationCert} />
            <DocRow label="2. Road Service License (RSL)" path={sacco.docRoadServiceLicense} />
            <DocRow label="3. Permit from County" path={sacco.docCountyPermit} />
            <DocRow label="4. Single Business Permit (SBP)" path={sacco.docSingleBusinessPermit} />
            <DocRow label="5. Tax Compliance Certificate" path={sacco.docTaxComplianceCert} />
            {sacco.saccoType === "NEW" && (
              <DocRow label="6. Letter of No Objection (required before RSL for new operators)" path={sacco.docLetterNoObjection} />
            )}

            <h5 className="text-xs font-extrabold text-black/70 uppercase tracking-wider pt-2">Bonafide Officials Contacts</h5>
            {officials ? (
              <div className="p-3 rounded-lg border border-black/10 bg-black/[0.01] space-y-2 text-xs">
                <div className="flex justify-between items-center border-b border-black/5 pb-1.5">
                  <span className="text-black/60 font-semibold">Chairperson:</span>
                  <span className="font-bold text-county-black">{officials.chairpersonName} ({officials.chairpersonPhone})</span>
                </div>
                <div className="flex justify-between items-center border-b border-black/5 pb-1.5">
                  <span className="text-black/60 font-semibold">Secretary:</span>
                  <span className="font-bold text-county-black">{officials.secretaryName} ({officials.secretaryPhone})</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-black/60 font-semibold">Treasurer:</span>
                  <span className="font-bold text-county-black">{officials.treasurerName} ({officials.treasurerPhone})</span>
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-lg border border-black/10 bg-black/[0.01] text-[11px] text-black/40 italic">
                Not yet provided by the operator.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pt-1 space-y-3">
        <h5 className="text-xs font-extrabold text-black/70 uppercase tracking-wider">Two-Stage County Verification</h5>
        <div className="grid md:grid-cols-2 gap-4">
          <VerificationStageControl
            label="Stage 1 · Director of Mobility"
            status={sacco.directorMobilityStatus || "PENDING"}
            reason={sacco.directorMobilityReason}
            decidedBy={sacco.directorMobilityDecidedBy}
            decidedAt={sacco.directorMobilityDecidedAt}
            canDecide={canDecideStage1 && Boolean(sacco.applicationSubmittedAt)}
            disabledHint={
              !sacco.applicationSubmittedAt
                ? "The operator hasn't finished and submitted their application yet."
                : "Only the Director of Mobility (or Admin) can decide this stage."
            }
            onDecide={(status, reason) => decideDirectorStageAction(sacco.id, status, reason)}
          />
          <VerificationStageControl
            label="Stage 2 · Chief Officer (Final)"
            status={sacco.chiefOfficerStatus || "PENDING"}
            reason={sacco.chiefOfficerReason}
            decidedBy={sacco.chiefOfficerDecidedBy}
            decidedAt={sacco.chiefOfficerDecidedAt}
            canDecide={canDecideStage2 && sacco.directorMobilityStatus === "APPROVED"}
            disabledHint={
              sacco.directorMobilityStatus !== "APPROVED"
                ? "Waiting on Stage 1 (Director of Mobility) approval first."
                : "Only the Chief Officer (or Admin) can decide this stage."
            }
            onDecide={(status, reason) => decideChiefOfficerStageAction(sacco.id, status, reason)}
          />
        </div>
      </div>
    </div>
  );
}
