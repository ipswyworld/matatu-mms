import type { Metadata } from "next";
import { getFeatureFlags, getRateLimits } from "@/lib/data";
import FeatureFlagsPanel from "@/components/FeatureFlagsPanel";
import RateLimitsPanel from "@/components/RateLimitsPanel";

export const metadata: Metadata = { title: "Config | Ops Console" };
export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const [flags, limits] = await Promise.all([getFeatureFlags(), getRateLimits()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Configuration</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Settings that change system behaviour without a redeploy. Every write is audited.
        </p>
      </div>

      <RateLimitsPanel limits={limits} />
      <FeatureFlagsPanel flags={flags} />
    </div>
  );
}
