"use client";

import { useRef, useState, useTransition } from "react";
import { MessageSquareWarning, Send } from "lucide-react";
import { submitReportAction } from "@/lib/actions";

/**
 * Standalone "Feedback & Reports" — previously a tab inside the booking
 * page's PageBanner switcher; moved to its own sidebar-linked route
 * (/feedback) so it's a real destination like every other role's
 * sections, not a mode buried behind a button on the booking page.
 */
export default function PassengerFeedbackForm({ passengerName, phone }: { passengerName?: string; phone?: string }) {
  const [feedbackMatatuReg, setFeedbackMatatuReg] = useState("");
  const [feedbackType, setFeedbackType] = useState("Overcharging Complaint");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackPhoto, setFeedbackPhoto] = useState<File | null>(null);
  const feedbackPhotoInputRef = useRef<HTMLInputElement>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackReportId, setFeedbackReportId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSendFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackMessage) return;
    setFeedbackError(null);
    startTransition(async () => {
      const result = await submitReportAction({
        matatuRegNumber: feedbackMatatuReg || undefined,
        category: feedbackType,
        message: feedbackMessage,
        reporterName: passengerName || undefined,
        reporterPhone: phone || undefined,
        photo: feedbackPhoto,
      });
      if (result.error) {
        setFeedbackError(result.error);
        return;
      }
      setFeedbackReportId(result.report?.id || null);
      setFeedbackSubmitted(true);
      setTimeout(() => {
        setFeedbackMessage("");
        setFeedbackMatatuReg("");
        setFeedbackPhoto(null);
        if (feedbackPhotoInputRef.current) feedbackPhotoInputRef.current.value = "";
        setFeedbackSubmitted(false);
      }, 3000);
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="card p-6 space-y-4">
        <h3 className="text-base font-extrabold text-county-black border-b border-black/10 pb-3 flex items-center gap-2">
          <MessageSquareWarning size={18} strokeWidth={2} className="text-county-ink/50" />
          Submit Commuter Report or Overcharging Complaint
        </h3>
        <p className="text-xs text-black/60">
          Report fare overcharging beyond published gazetted rates, reckless driving, or unroadworthy vehicles directly to County Traffic Officers.
        </p>

        {feedbackSubmitted ? (
          <div className="bg-county-green/10 text-county-green border border-county-green/30 rounded-xl p-4 text-xs font-bold text-center">
            Report Submitted to County Traffic Enforcement! Incident Log Reference: #{feedbackReportId || "PENDING"}
          </div>
        ) : (
          <form onSubmit={handleSendFeedback} className="space-y-4">
            {feedbackError && (
              <div className="bg-county-red/10 text-county-red border border-county-red/30 rounded-lg p-2.5 text-xs font-semibold">
                {feedbackError}
              </div>
            )}
            <div>
              <label className="label">Vehicle Plate Number (Optional)</label>
              <input
                type="text"
                value={feedbackMatatuReg}
                onChange={(e) => setFeedbackMatatuReg(e.target.value)}
                placeholder="e.g. KDA 112B"
                className="input"
              />
            </div>

            <div>
              <label className="label">Report Category</label>
              <select
                value={feedbackType}
                onChange={(e) => setFeedbackType(e.target.value)}
                className="input font-semibold"
              >
                <option value="Overcharging Complaint">Overcharging Beyond Gazetted Fare</option>
                <option value="Reckless Driving">Reckless Driving / Speeding</option>
                <option value="Loud Music / Noise Violation">Loud Music / Noise Violation</option>
                <option value="Expired Route Badge">Crew Missing Badges / Uniforms</option>
                <option value="Positive Service Compliment">Commendation / Service Compliment</option>
              </select>
            </div>

            <div>
              <label className="label">Complaint Details</label>
              <textarea
                rows={4}
                required
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
                placeholder="Describe location, conductor behavior, or extra fare demanded..."
                className="input"
              />
            </div>

            <div>
              <label className="label">Photo Evidence (Optional)</label>
              <input
                ref={feedbackPhotoInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setFeedbackPhoto(e.target.files?.[0] || null)}
                className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-black/5 file:px-3 file:py-1.5 file:text-xs file:font-bold"
              />
              {feedbackPhoto && (
                <p className="text-[11px] text-county-green font-semibold mt-1">Attached: {feedbackPhoto.name}</p>
              )}
            </div>

            <button type="submit" disabled={isPending} className="btn-primary w-full !py-2.5 text-sm font-bold flex items-center justify-center gap-2">
              <Send size={15} strokeWidth={2} />
              {isPending ? "Submitting..." : "Submit Official Commuter Report"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
