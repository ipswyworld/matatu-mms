"use client";

import { useState, useTransition } from "react";
import { assignCaseReviewerAction, addCaseNoteAction, resolveCaseDisputeAction } from "@/lib/actions";
import { CaseResolution, CaseReviewNote, EnforcementCaseStatus } from "@/lib/types";

const RESOLUTION_LABELS: Record<CaseResolution, string> = {
  UPHELD: "Uphold Fine",
  OVERTURNED: "Overturn Fine",
  PARTIAL: "Partially Uphold",
};

export default function DisputeCaseActions({
  caseId,
  status,
  reviewerId,
  reviewerName,
  reviewNotes,
  currentUserId,
}: {
  caseId: string;
  status: EnforcementCaseStatus;
  reviewerId?: string;
  reviewerName?: string;
  reviewNotes: CaseReviewNote[];
  currentUserId: string;
}) {
  const [localStatus, setLocalStatus] = useState(status);
  const [localReviewerId, setLocalReviewerId] = useState(reviewerId);
  const [localReviewerName, setLocalReviewerName] = useState(reviewerName);
  const [localNotes, setLocalNotes] = useState(reviewNotes);
  const [noteText, setNoteText] = useState("");
  const [resolving, setResolving] = useState<CaseResolution | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (localStatus.startsWith("RESOLVED_")) {
    return <span className="text-[11px] font-bold text-black/40">Resolved — no further action</span>;
  }

  const handleAssignToMe = () => {
    setError(null);
    startTransition(async () => {
      const result = await assignCaseReviewerAction(caseId, currentUserId);
      if (result.error) { setError(result.error); return; }
      setLocalStatus("UNDER_REVIEW");
      setLocalReviewerId(currentUserId);
    });
  };

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await addCaseNoteAction(caseId, noteText.trim());
      if (result.error) { setError(result.error); return; }
      setLocalNotes([...localNotes, { authorId: currentUserId, authorName: "You", note: noteText.trim(), at: new Date().toISOString() }]);
      setNoteText("");
    });
  };

  const handleResolve = () => {
    if (!resolving) return;
    if (!resolveReason.trim()) { setError("A decision reason is required."); return; }
    setError(null);
    startTransition(async () => {
      const result = await resolveCaseDisputeAction(caseId, resolving, resolveReason.trim());
      if (result.error) { setError(result.error); return; }
      setLocalStatus(`RESOLVED_${resolving}` as EnforcementCaseStatus);
    });
  };

  if (localStatus === "DISPUTED") {
    return (
      <div className="space-y-1.5 min-w-[160px]">
        {error && <p className="text-[11px] text-county-red font-semibold">{error}</p>}
        <button
          disabled={isPending}
          onClick={handleAssignToMe}
          className="text-[10px] font-bold text-white bg-county-blue rounded px-2 py-1 disabled:opacity-40"
        >
          {isPending ? "..." : "Assign to Me"}
        </button>
      </div>
    );
  }

  // UNDER_REVIEW
  const isMyCase = localReviewerId === currentUserId;
  return (
    <div className="space-y-2 min-w-[240px]">
      {error && <p className="text-[11px] text-county-red font-semibold">{error}</p>}
      <p className="text-[10px] text-black/50">
        Reviewer: <span className="font-bold text-county-black">{isMyCase ? "You" : localReviewerName || "—"}</span>
      </p>

      {localNotes.length > 0 && (
        <div className="space-y-1 max-h-24 overflow-y-auto scrollbar-ghost">
          {localNotes.map((n, i) => (
            <div key={i} className="text-[10px] bg-black/[0.03] rounded px-1.5 py-1">
              <span className="font-bold text-county-black">{n.authorName}:</span> {n.note}
            </div>
          ))}
        </div>
      )}

      {isMyCase && !resolving && (
        <>
          <div className="flex gap-1">
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a review note..."
              className="flex-1 text-[11px] border border-black/15 rounded px-2 py-1"
            />
            <button disabled={isPending} onClick={handleAddNote} className="text-[10px] font-bold text-county-black bg-black/10 rounded px-2 py-1">
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-black/5">
            {(["OVERTURNED", "PARTIAL", "UPHELD"] as CaseResolution[]).map((r) => (
              <button
                key={r}
                onClick={() => setResolving(r)}
                className={`text-[10px] font-bold rounded px-2 py-1 ${
                  r === "OVERTURNED"
                    ? "text-county-green bg-county-green/10 hover:bg-county-green/20"
                    : r === "UPHELD"
                    ? "text-county-red bg-county-red/10 hover:bg-county-red/20"
                    : "text-county-blue bg-county-blue/10 hover:bg-county-blue/20"
                }`}
              >
                {RESOLUTION_LABELS[r]}
              </button>
            ))}
          </div>
        </>
      )}

      {isMyCase && resolving && (
        <div className="space-y-1 pt-1 border-t border-black/5">
          <p className="text-[10px] font-bold text-county-black">{RESOLUTION_LABELS[resolving]} — decision reason:</p>
          <input
            value={resolveReason}
            onChange={(e) => setResolveReason(e.target.value)}
            placeholder="Why this decision?"
            className="w-full text-[11px] border border-black/15 rounded px-2 py-1"
          />
          <div className="flex gap-1.5">
            <button disabled={isPending} onClick={handleResolve} className="text-[10px] font-bold text-white bg-county-black rounded px-2 py-1">
              {isPending ? "..." : "Confirm Resolution"}
            </button>
            <button onClick={() => { setResolving(null); setResolveReason(""); }} className="text-[10px] font-bold text-black/50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
