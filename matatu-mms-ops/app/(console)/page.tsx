import type { Metadata } from "next";
import { getOpsOverview } from "@/lib/data";
import OverviewLive from "@/components/OverviewLive";

export const metadata: Metadata = { title: "Overview | Ops Console" };
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  // Degraded-mode rendering is a requirement, not a nicety (Spec §21.4):
  // if the control plane is unreachable the page must still render and say
  // so, because a console that fails to paint has failed at the one job it
  // exists for. The client then keeps retrying over SSE.
  let initial = null;
  let fetchError: string | null = null;
  try {
    initial = await getOpsOverview();
  } catch (err: any) {
    fetchError = err?.message || "Could not reach the control plane.";
  }

  return (
    <>
      {fetchError && (
        <div className="mb-4 rounded-lg border border-county-red/30 bg-county-red/5 px-4 py-2.5 text-xs font-semibold text-county-red">
          Could not load the initial snapshot: {fetchError}. Retrying live.
        </div>
      )}
      <OverviewLive initial={initial} />
    </>
  );
}
