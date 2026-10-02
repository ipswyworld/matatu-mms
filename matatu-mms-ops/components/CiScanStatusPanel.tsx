import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { CiScanStatus } from "@/lib/types";

const CONCLUSION_STYLE: Record<string, { icon: typeof ShieldCheck; className: string; label: string }> = {
  success: { icon: ShieldCheck, className: "bg-county-green/10 text-county-green", label: "CLEAN" },
  failure: { icon: ShieldAlert, className: "bg-county-red/10 text-county-red", label: "FINDINGS" },
  cancelled: { icon: ShieldQuestion, className: "bg-black/10 text-black/50", label: "CANCELLED" },
};

/**
 * Reads .github/workflows/ci.yml's "Dependency + container vulnerability
 * scan" job result via GitHub's Jobs API (app/ci_status.py) — that job runs
 * pip-audit, npm audit, and Trivy already, with continue-on-error so a
 * finding doesn't block every PR. That also means the workflow RUN's own
 * conclusion is always "success" regardless of findings; only the job's own
 * conclusion carries the real signal, which is what's shown here.
 */
export default function CiScanStatusPanel({ status }: { status: CiScanStatus | null }) {
  return (
    <div className="card p-5 space-y-3">
      <div>
        <h3 className="font-bold text-sm text-county-black">Dependency &amp; CVE Scan</h3>
        <p className="text-xs text-black/50 mt-0.5">
          Latest result of CI&apos;s pip-audit / npm audit / Trivy job — read from GitHub, not run from here.
        </p>
      </div>

      {status === null ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          Not configured — set <span className="font-mono font-bold">GITHUB_BACKUP_TOKEN</span> and{" "}
          <span className="font-mono font-bold">GITHUB_BACKUP_REPO</span> on the backend (the same ones used for
          automated database backups) to enable this panel.
        </p>
      ) : !status.scanJobFound ? (
        <p className="text-xs text-black/50">
          The latest CI run didn&apos;t include the scan job yet.{" "}
          <a href={status.runUrl} target="_blank" rel="noreferrer" className="text-county-green hover:underline">
            View run
          </a>
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {(() => {
              const style = CONCLUSION_STYLE[status.scanConclusion || ""] || {
                icon: ShieldQuestion,
                className: "bg-black/10 text-black/50",
                label: (status.scanConclusion || "UNKNOWN").toUpperCase(),
              };
              const Icon = style.icon;
              return (
                <span className={`badge font-extrabold text-[10px] inline-flex items-center gap-1 ${style.className}`}>
                  <Icon size={11} strokeWidth={2.5} />
                  {style.label}
                </span>
              );
            })()}
            <span className="text-[11px] text-black/50 font-mono">{status.headSha}</span>
          </div>
          <a href={status.scanUrl} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-county-green hover:underline">
            View scan job →
          </a>
        </div>
      )}

      {status && (
        <p className="text-[10px] text-black/35">Run started {new Date(status.runCreatedAt).toLocaleString()}</p>
      )}
    </div>
  );
}
