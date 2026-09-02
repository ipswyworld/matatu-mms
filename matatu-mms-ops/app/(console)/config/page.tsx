import type { Metadata } from "next";
import { getFeatureFlags, getRateLimits, getSystemControls } from "@/lib/data";
import FeatureFlagsPanel from "@/components/FeatureFlagsPanel";
import RateLimitsPanel from "@/components/RateLimitsPanel";
import SystemControlsPanel from "@/components/SystemControlsPanel";
import PanelError, { settle } from "@/components/PanelError";

export const metadata: Metadata = { title: "Config | Ops Console" };
export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  // Each panel's fetch is settled independently (Spec §21.4). One
  // unreachable source must not blank the page — least of all this page,
  // which holds the controls for turning maintenance mode back off.
  const [flags, limits, controls] = await Promise.all([
    settle(getFeatureFlags()),
    settle(getRateLimits()),
    settle(getSystemControls()),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Configuration</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Settings that change system behaviour without a redeploy. Every write is audited.
        </p>
      </div>

      {controls.data ? (
        <SystemControlsPanel controls={controls.data} />
      ) : (
        <PanelError title="Incident controls" error={controls.error!} />
      )}

      {limits.data ? (
        <RateLimitsPanel limits={limits.data} />
      ) : (
        <PanelError title="Rate limits" error={limits.error!} />
      )}

      {flags.data ? (
        <FeatureFlagsPanel flags={flags.data} />
      ) : (
        <PanelError title="Feature flags" error={flags.error!} />
      )}
    </div>
  );
}
