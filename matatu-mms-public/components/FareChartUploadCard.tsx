"use client";

import { useRef, useState, useTransition } from "react";
import { uploadFareChartAction } from "@/lib/actions";
import { Route } from "@/lib/types";

/** Distinct from the Fare Chart *document* uploaded during onboarding (a
 * compliance record kept on the Sacco). This parses a PDF fare table into
 * structured per-stage-pair pricing for one specific route — routes aren't
 * Sacco-owned (a Sacco can run several), so the parser needs a route picked
 * explicitly rather than being auto-triggered off the compliance upload. */
export default function FareChartUploadCard({ routes }: { routes: Route[] }) {
  const [routeId, setRouteId] = useState(routes[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; unmatched: number; total: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  if (routes.length === 0) return null;

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF file first.");
      return;
    }
    if (!routeId) {
      setError("Pick which route this fare chart applies to.");
      return;
    }
    setError(null);
    setResult(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const res = await uploadFareChartAction(routeId, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult({ created: res.created ?? 0, unmatched: res.unmatched ?? 0, total: res.total ?? 0 });
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h3 className="font-bold text-sm text-county-black">Structured Fare Chart (Per-Stage Pricing)</h3>
        <p className="text-xs text-black/50">
          Upload a PDF table (From / To / Fare columns) to set exact fares between stage pairs on one of your
          routes — this powers passenger fare estimates, separate from the compliance Fare Chart document above.
        </p>
      </div>

      {error && (
        <div className="bg-county-red/10 border border-county-red/30 text-county-red text-xs p-2.5 rounded-lg font-semibold">
          {error}
        </div>
      )}
      {result && (
        <div className="bg-county-green/10 border border-county-green/30 text-county-green text-xs p-2.5 rounded-lg font-semibold">
          Parsed {result.total} row{result.total === 1 ? "" : "s"} — {result.created} fare
          {result.created === 1 ? "" : "s"} saved
          {result.unmatched > 0 && `, ${result.unmatched} stage name${result.unmatched === 1 ? "" : "s"} didn't match an existing stage`}.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="input font-semibold w-auto text-xs !py-1.5">
          {routes.map((r) => (
            <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          className="text-[10px] w-40 file:mr-1.5 file:rounded file:border-0 file:bg-black/5 file:px-2 file:py-1 file:text-[10px] file:font-bold"
        />
        <button type="button" onClick={handleUpload} disabled={isPending} className="btn-secondary !py-1 !px-2.5 text-[10px] font-bold">
          {isPending ? "Parsing..." : "Upload & Parse"}
        </button>
      </div>
    </div>
  );
}
