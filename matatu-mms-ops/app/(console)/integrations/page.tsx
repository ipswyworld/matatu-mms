import type { Metadata } from "next";
import { getCircuitBreakers, getWebhookDeliveries } from "@/lib/data";
import CircuitBreakerPanel from "@/components/CircuitBreakerPanel";
import WebhookDeliveriesPanel from "@/components/WebhookDeliveriesPanel";

export const metadata: Metadata = { title: "Integrations | Ops Console" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [breakers, deliveries] = await Promise.all([getCircuitBreakers(), getWebhookDeliveries()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Integrations</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Third-party dependency health and outbound webhook delivery.
        </p>
      </div>

      <CircuitBreakerPanel breakers={breakers} />
      <WebhookDeliveriesPanel deliveries={deliveries} />
    </div>
  );
}
