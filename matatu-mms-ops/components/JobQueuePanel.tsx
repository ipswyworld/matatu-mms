"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { JobSummary } from "@/lib/types";
import { retryJobAction } from "@/lib/actions";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-black/5 text-black/60",
  deferred: "bg-black/5 text-black/60",
  in_progress: "bg-amber-500/10 text-amber-700",
  complete: "bg-county-green/10 text-county-green",
};

function StatusBadge({ status, success }: { status: string; success: boolean | null }) {
  const failed = status === "complete" && success === false;
  const label = failed ? "FAILED" : status.replace("_", " ").toUpperCase();
  const style = failed ? "bg-county-red/10 text-county-red" : STATUS_STYLES[status] || "bg-black/5 text-black/60";
  return <span className={`badge text-[10px] font-bold ${style}`}>{label}</span>;
}

function JobRow({ job }: { job: JobSummary }) {
  const [retried, setRetried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const failed = job.status === "complete" && job.success === false;

  function handleRetry() {
    startTransition(async () => {
      const result = await retryJobAction(job.jobId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRetried(true);
    });
  }

  return (
    <tr>
      <td className="py-2 pr-3 font-mono text-xs text-county-black">{job.function}</td>
      <td className="py-2 pr-3"><StatusBadge status={job.status} success={job.success} /></td>
      <td className="py-2 pr-3 text-[11px] text-black/50 whitespace-nowrap">
        {job.finishTime ? new Date(job.finishTime).toLocaleString() : new Date(job.enqueueTime).toLocaleString()}
      </td>
      <td className="py-2 pr-3 text-[11px] text-black/50">{job.jobTry ?? "—"}</td>
      <td className="py-2 text-[11px] text-black/60 max-w-xs truncate" title={job.resultPreview || undefined}>
        {job.resultPreview || "—"}
      </td>
      <td className="py-2 pl-2">
        {failed && !retried && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={isPending}
            className="flex items-center gap-1 text-[10px] font-bold text-county-green hover:underline disabled:opacity-50"
          >
            <RotateCcw size={11} strokeWidth={2.5} />
            {isPending ? "Retrying…" : "Retry"}
          </button>
        )}
        {retried && <span className="text-[10px] font-bold text-county-green">Re-queued</span>}
        {error && <span className="text-[10px] font-bold text-county-red">{error}</span>}
      </td>
    </tr>
  );
}

export default function JobQueuePanel({ jobs }: { jobs: JobSummary[] }) {
  const queued = jobs.filter((j) => j.status === "queued" || j.status === "deferred").length;
  const inProgress = jobs.filter((j) => j.status === "in_progress").length;
  const failed = jobs.filter((j) => j.status === "complete" && j.success === false).length;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-county-black">Background Jobs</h3>
          <p className="text-xs text-black/50 mt-0.5">
            The real ARQ queue — retry re-enqueues a failed job's exact function and arguments. No pause/dead-letter
            controls: ARQ has no such primitive to back them safely.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <span className="badge text-[10px] font-bold bg-black/5 text-black/60">{queued} QUEUED</span>
          <span className="badge text-[10px] font-bold bg-amber-500/10 text-amber-700">{inProgress} RUNNING</span>
          <span className={`badge text-[10px] font-bold ${failed > 0 ? "bg-county-red/10 text-county-red" : "bg-county-green/10 text-county-green"}`}>{failed} FAILED</span>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-xs text-black/40 italic">No jobs queued, running, or recently completed.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-black/40">
                <th className="pb-2 pr-3">Function</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">When</th>
                <th className="pb-2 pr-3">Try</th>
                <th className="pb-2">Result</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {jobs.map((job) => (
                <JobRow key={job.jobId} job={job} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
