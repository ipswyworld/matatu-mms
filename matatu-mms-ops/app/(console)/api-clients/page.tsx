import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { getApiClients, getApiScopes, getSaccoOptions } from "@/lib/data";
import ApiClientsPanel from "@/components/ApiClientsPanel";
import PanelError, { settle } from "@/components/PanelError";

export const metadata: Metadata = { title: "API Clients | Ops Console" };
export const dynamic = "force-dynamic";

export default async function ApiClientsPage() {
  const [clients, scopesRes, saccos] = await Promise.all([
    settle(getApiClients()),
    settle(getApiScopes()),
    settle(getSaccoOptions()),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight text-county-ink">API Clients</h1>
          <p className="text-xs text-black/50 mt-0.5">
            Issue and manage credentials for partners integrating with this system's API. Every issuance and
            revocation requires a reason and re-authentication, and is recorded in the Audit tab.
          </p>
        </div>
        <Link
          href="/api-clients/docs"
          className="shrink-0 text-xs font-bold text-county-green hover:underline inline-flex items-center gap-1"
        >
          <BookOpen size={13} strokeWidth={2.5} />
          Developer docs
        </Link>
      </div>

      {clients.data && scopesRes.data && saccos.data ? (
        <ApiClientsPanel
          clients={clients.data}
          scopes={scopesRes.data.scopes}
          quotaTiers={scopesRes.data.quotaTiers}
          saccos={saccos.data}
        />
      ) : (
        <PanelError
          title="API clients"
          error={clients.error || scopesRes.error || saccos.error || "Could not load this page."}
        />
      )}
    </div>
  );
}
