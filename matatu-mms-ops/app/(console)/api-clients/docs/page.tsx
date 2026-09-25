import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getApiScopes } from "@/lib/data";
import PanelError, { settle } from "@/components/PanelError";

export const metadata: Metadata = { title: "API Developer Docs | Ops Console" };
export const dynamic = "force-dynamic";

const BACKEND_PUBLIC_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://127.0.0.1:8000";

export default async function ApiDeveloperDocsPage() {
  const scopesRes = await settle(getApiScopes());

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link href="/api-clients" className="text-xs font-bold text-county-green hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={12} strokeWidth={2.5} />
          Back to API Clients
        </Link>
        <h1 className="text-xl font-black tracking-tight text-county-ink mt-2">Partner API — Developer Guide</h1>
        <p className="text-xs text-black/50 mt-0.5">
          For a partner or third-party integration consuming this system's API. Get a client issued from the API
          Clients page first — you'll need a client ID and secret before any of this works.
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm text-county-black">1. Authenticate</h3>
        <p className="text-xs text-black/70">
          Exchange your client ID and secret for a short-lived bearer token via OAuth2's client-credentials grant:
        </p>
        <pre className="bg-black/[0.03] border border-black/10 rounded-lg p-3 text-[11px] font-mono overflow-x-auto">
{`curl -X POST ${BACKEND_PUBLIC_URL}/api/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"`}
        </pre>
        <p className="text-xs text-black/70">
          Use the returned <code className="font-mono bg-black/5 px-1 rounded">access_token</code> as a Bearer token
          on every request below. Tokens are short-lived — request a new one when a call starts returning 401.
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm text-county-black">2. Call an endpoint</h3>
        <pre className="bg-black/[0.03] border border-black/10 rounded-lg p-3 text-[11px] font-mono overflow-x-auto">
{`curl ${BACKEND_PUBLIC_URL}/api/v1/whoami \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"`}
        </pre>
        <p className="text-xs text-black/70">
          <code className="font-mono bg-black/5 px-1 rounded">/api/v1/whoami</code> is the fastest way to confirm
          your token works and see exactly which scopes it carries — useful for catching a scoping mistake before it
          costs a support round trip.
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm text-county-black">3. Available scopes</h3>
        {scopesRes.data ? (
          <div className="space-y-2">
            {scopesRes.data.scopes.map((s) => (
              <div key={s.scope} className="rounded-lg border border-black/10 p-3">
                <span className="font-mono text-xs font-bold text-county-green">{s.scope}</span>
                <p className="text-[11px] text-black/60 mt-0.5">{s.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <PanelError title="Scope catalogue" error={scopesRes.error || "Could not load this page."} />
        )}
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm text-county-black">4. Rate limits</h3>
        {scopesRes.data ? (
          <ul className="text-xs text-black/70 space-y-1">
            {Object.entries(scopesRes.data.quotaTiers).map(([tier, limit]) => (
              <li key={tier}>
                <span className="font-mono font-bold">{tier}</span>: {limit}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-black/40 italic">Unavailable.</p>
        )}
        <p className="text-[11px] text-black/50">
          Exceeding your tier returns <code className="font-mono bg-black/5 px-1 rounded">429</code> with a
          <code className="font-mono bg-black/5 px-1 rounded ml-1">Retry-After</code> header — back off and retry
          rather than hammering the endpoint.
        </p>
      </div>

      <div className="card p-5 space-y-2">
        <h3 className="font-bold text-sm text-county-black">Full reference</h3>
        <p className="text-xs text-black/70">
          Every endpoint, request/response shape, and error code is documented in the live interactive reference:
        </p>
        <a
          href={`${BACKEND_PUBLIC_URL}/docs`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-bold text-county-green hover:underline inline-flex items-center gap-1"
        >
          Open API reference (Swagger)
          <ExternalLink size={11} strokeWidth={2.5} />
        </a>
      </div>
    </div>
  );
}
