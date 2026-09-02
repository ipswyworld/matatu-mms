import type { Metadata } from "next";
import { getJobQueue } from "@/lib/data";
import JobQueuePanel from "@/components/JobQueuePanel";

export const metadata: Metadata = { title: "Jobs | Ops Console" };
export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const jobs = await getJobQueue();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Background Jobs</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Everything ARQ currently knows about: queued, running, and recently completed.
        </p>
      </div>
      <JobQueuePanel jobs={jobs} />
    </div>
  );
}
