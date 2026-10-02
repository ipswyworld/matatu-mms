"use client";

import { CheckCircle2, XCircle, DatabaseBackup } from "lucide-react";
import { BackupRestoreTest } from "@/lib/types";
import { triggerRestoreTestAction } from "@/lib/actions";
import ActionButton from "@/components/ActionButton";

/**
 * Reads app/restore_verify.py's weekly cron results — proves the nightly
 * backup can actually be restored, into a dedicated scratch database, never
 * production. Manual trigger runs the identical function on demand.
 */
export default function BackupRestoreTestPanel({ tests }: { tests: BackupRestoreTest[] }) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
            <DatabaseBackup size={15} strokeWidth={2} className="text-county-ink/50" />
            Backup Restore Test
          </h3>
          <p className="text-xs text-black/50 mt-0.5">
            Weekly (Sunday, 30 min after the nightly backup) — restores into a scratch database, never production.
          </p>
        </div>
        <ActionButton
          actionId="backup.testRestore"
          target="scratch verification database"
          onConfirm={(reason, reauthToken) => triggerRestoreTestAction(reason, reauthToken)}
          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-black/10 hover:bg-black/5 transition-colors"
        >
          Run now
        </ActionButton>
      </div>

      {tests.length === 0 ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          No restore test has run yet — set <span className="font-mono font-bold">RESTORE_VERIFY_DATABASE_URL</span> on
          the backend, migrate that scratch database once with <span className="font-mono">alembic upgrade head</span>,
          then wait for Sunday or run one now.
        </p>
      ) : (
        <div className="space-y-1.5">
          {tests.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 text-[11px] py-1.5 border-b border-black/5 last:border-0 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`badge text-[9px] font-extrabold inline-flex items-center gap-1 ${
                    t.success ? "bg-county-green/10 text-county-green" : "bg-county-red/10 text-county-red"
                  }`}
                >
                  {t.success ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {t.success ? "PASS" : "FAIL"}
                </span>
                <span className="text-black/50">{new Date(t.testedAt).toLocaleString()}</span>
                {t.backupTag && <span className="font-mono text-black/40 truncate">{t.backupTag}</span>}
              </div>
              <span className="text-black/40 shrink-0">
                {t.durationSeconds}s
                {t.success && t.rowCounts && ` · ${Object.keys(t.rowCounts).length} tables`}
                {!t.success && t.error && <span className="text-county-red"> · {t.error.slice(0, 80)}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
