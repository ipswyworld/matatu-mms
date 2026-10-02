import type { Metadata } from "next";
import { getRetentionReview, getDataSubjectRequests, getDataQualityChecks } from "@/lib/data";
import RetentionReviewPanel from "@/components/RetentionReviewPanel";
import DataSubjectRequestsPanel from "@/components/DataSubjectRequestsPanel";
import DataQualityPanel from "@/components/DataQualityPanel";
import PanelError, { settle } from "@/components/PanelError";

export const metadata: Metadata = { title: "Compliance | Ops Console" };
export const dynamic = "force-dynamic";

// Unset by default — no Metabase (or similar BI/DB-browser) instance is
// provisioned for this project. Surfaced honestly, same pattern as the
// Infrastructure page's Grafana embed, rather than an iframe pointed at
// nothing.
const DB_BROWSER_EMBED_URL = process.env.DB_BROWSER_EMBED_URL;

export default async function CompliancePage() {
  const [retention, dsr, dataQuality] = await Promise.all([
    settle(getRetentionReview()),
    settle(getDataSubjectRequests()),
    settle(getDataQualityChecks()),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Compliance</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Data governance — retention review, data-subject requests, and data-quality checks.
        </p>
      </div>

      {retention.data ? (
        <RetentionReviewPanel rows={retention.data} />
      ) : (
        <PanelError title="Retention review" error={retention.error!} />
      )}

      {dsr.data ? (
        <DataSubjectRequestsPanel requests={dsr.data} />
      ) : (
        <PanelError title="Data subject requests" error={dsr.error!} />
      )}

      {dataQuality.data ? (
        <DataQualityPanel checks={dataQuality.data} />
      ) : (
        <PanelError title="Data quality" error={dataQuality.error!} />
      )}

      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-bold text-sm text-county-black">Read-Only DB Browser</h3>
          <p className="text-xs text-black/50 mt-0.5">
            For ad-hoc queries against production data — a BI tool, not this console, is the right place for that.
          </p>
        </div>
        {DB_BROWSER_EMBED_URL ? (
          <iframe
            src={DB_BROWSER_EMBED_URL}
            title="Read-only database browser"
            className="w-full h-[600px] rounded-lg border border-black/10"
          />
        ) : (
          <p className="text-[11px] text-black/50 bg-black/[0.02] border border-black/10 rounded-lg px-3 py-2.5">
            Not configured — set <span className="font-mono font-semibold">DB_BROWSER_EMBED_URL</span> for this
            service to embed one (e.g. a Metabase instance with a read-only database user). No such instance is
            provisioned for this project yet; deciding on and standing one up is an infra decision, not a frontend one.
          </p>
        )}
      </div>
    </div>
  );
}
