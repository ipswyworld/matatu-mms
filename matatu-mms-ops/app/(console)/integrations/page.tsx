import type { Metadata } from "next";
import { getCircuitBreakers, getWebhookDeliveries } from "@/lib/data";
import CircuitBreakerPanel from "@/components/CircuitBreakerPanel";
import WebhookDeliveriesPanel from "@/components/WebhookDeliveriesPanel";
import PanelError, { settle } from "@/components/PanelError";

export const metadata: Metadata = { title: "Integrations | Ops Console" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [breakers, deliveries] = await Promise.all([
    settle(getCircuitBreakers()),
    settle(getWebhookDeliveries()),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-tight text-county-ink">Integrations</h1>
        <p className="text-xs text-black/50 mt-0.5">
          Third-party dependency health and outbound webhook delivery.
        </p>
      </div>

      {breakers.data ? (
        <CircuitBreakerPanel breakers={breakers.data} />
      ) : (
        <PanelError title="Circuit breakers" error={breakers.error!} />
      )}

      {deliveries.data ? (
        <WebhookDeliveriesPanel deliveries={deliveries.data} />
      ) : (
        <PanelError title="Webhook deliveries" error={deliveries.error!} />
      )}
    </div>
  );
}
