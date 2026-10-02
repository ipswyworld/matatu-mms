"use client";

import { useState } from "react";
import type { RateLimitState } from "@/lib/types";
import { updateRateLimitAction } from "@/lib/actions";
import ActionButton from "./ActionButton";
import ConfigDiff from "./ConfigDiff";

/**
 * Live rate limit control (Ops Console Rebuild Spec §6.1).
 *
 * These used to be decorator literals, which meant changing one in
 * production was an edit-commit-push-redeploy cycle. That is the loop this
 * panel exists to remove — it came directly out of an incident where the
 * login limit had to be raised while people were actively locked out.
 */
function LimitRow({ limit }: { limit: RateLimitState }) {
  const [draft, setDraft] = useState(limit.effective);
  const dirty = draft.trim() !== limit.effective;

  return (
    <div className="rounded-lg border border-black/10 bg-black/[0.01] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-county-green">{limit.scope}</span>
            {limit.overridden && (
              <span className="badge text-[9px] font-extrabold bg-amber-100 text-amber-800">OVERRIDDEN</span>
            )}
          </div>
          {limit.description && <p className="text-[11px] text-black/60 mt-1">{limit.description}</p>}
          <p className="text-[10px] text-black/40 mt-0.5">
            Effective <span className="font-mono font-bold text-black/60">{limit.effective}</span> · default{" "}
            <span className="font-mono">{limit.default}</span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="100/minute"
            className="input !py-1.5 text-xs font-mono w-32"
            aria-label={`New limit for ${limit.scope}`}
          />
          <ActionButton
            actionId="rateLimit.update"
            target={limit.scope}
            disabled={!dirty}
            onConfirm={(reason) => updateRateLimitAction(limit.scope, draft.trim(), reason)}
            preview={<ConfigDiff label={limit.scope} from={limit.effective} to={draft.trim()} />}
          >
            Apply
          </ActionButton>
          {limit.overridden && (
            <ActionButton
              actionId="rateLimit.update"
              target={`${limit.scope} (restore default)`}
              onConfirm={(reason) => updateRateLimitAction(limit.scope, null, reason)}
              preview={<ConfigDiff label={`${limit.scope} (restore default)`} from={limit.effective} to={limit.default} />}
            >
              Restore default
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RateLimitsPanel({ limits }: { limits: RateLimitState[] }) {
  const overridden = limits.filter((l) => l.overridden).length;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-county-black">Rate Limits</h3>
          <p className="text-xs text-black/50 mt-0.5">
            Written to Postgres, mirrored to Redis, and cached in-process. A change takes effect on this replica
            immediately and on the others within about ten seconds. Raising a limit weakens the protection it
            provides.
          </p>
        </div>
        {overridden > 0 && (
          <span className="badge text-[10px] font-bold bg-amber-100 text-amber-800 shrink-0">
            {overridden} OVERRIDDEN
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {limits.map((limit) => (
          <LimitRow key={limit.scope} limit={limit} />
        ))}
      </div>
    </div>
  );
}
