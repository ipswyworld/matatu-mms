"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, Copy, KeyRound } from "lucide-react";
import { ApiClient, ApiClientIssuedSecret, ApiClientUsageDay, ApiScope, SaccoOption } from "@/lib/types";
import { createApiClientAction, revokeApiClientAction, getApiClientUsageHistoryAction, CreateApiClientInput } from "@/lib/actions";
import ActionButton from "./ActionButton";

const EFFECTIVE_ROLES = ["SACCO_OPERATOR", "ADMIN", "VIEWER"];

function UsageSparkline({ days }: { days: ApiClientUsageDay[] }) {
  if (days.length === 0) return <p className="text-[11px] text-black/40 italic">No usage recorded yet.</p>;
  const max = Math.max(1, ...days.map((d) => d.requests));
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-[2px] h-16">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.requests} requests`}
            className="flex-1 bg-county-green/70 rounded-sm min-h-[2px] hover:bg-county-green transition-colors"
            style={{ height: `${Math.max(4, (d.requests / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-black/40">
        <span>{days[0]?.date}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function ClientRow({ client }: { client: ApiClient }) {
  const [expanded, setExpanded] = useState(false);
  const [usage, setUsage] = useState<ApiClientUsageDay[] | null>(null);
  const [loadingUsage, startUsageTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && usage === null) {
      startUsageTransition(async () => {
        const days = await getApiClientUsageHistoryAction(client.clientId);
        setUsage(days);
      });
    }
  }

  return (
    <div className={`rounded-lg border ${client.active ? "border-black/10" : "border-black/10 bg-black/[0.015] opacity-70"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-county-black">{client.name}</span>
            <span
              className={`badge text-[9px] font-extrabold ${
                client.environment === "sandbox" ? "bg-amber-100 text-amber-800" : "bg-county-blue/10 text-county-blue"
              }`}
            >
              {client.environment.toUpperCase()}
            </span>
            {!client.active && <span className="badge text-[9px] font-extrabold bg-county-red/10 text-county-red">REVOKED</span>}
          </div>
          <p className="font-mono text-[11px] text-black/50 mt-0.5">{client.clientId}</p>
          <p className="text-[11px] text-black/50 mt-0.5">
            {client.scopes.join(", ") || "no scopes"} · {client.quotaTier} tier
            {client.saccoId && ` · Sacco ${client.saccoId}`}
          </p>
          {client.ipAllowlist.length > 0 && (
            <p className="text-[10px] font-mono text-black/40 mt-0.5">Allowed IPs: {client.ipAllowlist.join(", ")}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-black/50">
            {client.usage.used}/{client.usage.limit} this window
          </span>
          <button
            type="button"
            onClick={toggleExpand}
            className="text-black/40 hover:text-black/70 p-1"
            aria-label="Toggle usage history"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {client.active && (
            <ActionButton
              actionId="apiClient.revoke"
              target={client.name}
              onConfirm={async (reason, token) => {
                const result = await revokeApiClientAction(client.clientId, reason, token);
                if (result.error) setError(result.error);
                return result;
              }}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-county-red/30 text-county-red hover:bg-county-red/5"
            >
              Revoke
            </ActionButton>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-black/5">
          {loadingUsage && usage === null ? (
            <p className="text-[11px] text-black/40">Loading usage…</p>
          ) : (
            <UsageSparkline days={usage || []} />
          )}
        </div>
      )}
      {error && <p className="px-3 pb-2 text-[11px] text-county-red font-semibold">{error}</p>}
    </div>
  );
}

export default function ApiClientsPanel({
  clients,
  scopes,
  quotaTiers,
  saccos,
}: {
  clients: ApiClient[];
  scopes: ApiScope[];
  quotaTiers: Record<string, string>;
  saccos: SaccoOption[];
}) {
  const [name, setName] = useState("");
  const [effectiveRole, setEffectiveRole] = useState("SACCO_OPERATOR");
  const [saccoId, setSaccoId] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [quotaTier, setQuotaTier] = useState(Object.keys(quotaTiers)[0] || "partner");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [ipAllowlistText, setIpAllowlistText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<ApiClientIssuedSecret | null>(null);
  const [copied, setCopied] = useState(false);

  const activeClients = clients.filter((c) => c.active);
  const revokedClients = clients.filter((c) => !c.active);

  function toggleScope(scope: string) {
    setSelectedScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  function resetForm() {
    setName("");
    setSelectedScopes([]);
    setSaccoId("");
    setIpAllowlistText("");
  }

  function buildInput(): CreateApiClientInput | null {
    if (!name.trim()) {
      setFormError("Give this client a name — usually the partner's own name.");
      return null;
    }
    if (selectedScopes.length === 0) {
      setFormError("Pick at least one scope.");
      return null;
    }
    if (effectiveRole === "SACCO_OPERATOR" && !saccoId) {
      setFormError("A Sacco-scoped client needs a Sacco picked, or it can see nothing.");
      return null;
    }
    setFormError(null);
    return {
      name: name.trim(),
      saccoId: effectiveRole === "SACCO_OPERATOR" ? saccoId : undefined,
      scopes: selectedScopes,
      quotaTier,
      effectiveRole,
      environment,
      ipAllowlist: ipAllowlistText.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-bold text-sm text-county-black flex items-center gap-1.5">
            <KeyRound size={15} strokeWidth={2} className="text-county-ink/50" />
            Issue a new API client
          </h3>
          <p className="text-xs text-black/50 mt-0.5">
            For handing this system's API to a partner or third-party integration. The secret is shown exactly once
            — copy it before closing this page.
          </p>
        </div>

        {issued && (
          <div className="rounded-lg border border-county-green/30 bg-county-green/5 p-4 space-y-2">
            <p className="text-xs font-bold text-county-green">{issued.warning}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-white border border-black/10 rounded-lg px-3 py-2 break-all">
                {issued.clientSecret}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(issued.clientSecret);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="shrink-0 p-2 rounded-lg border border-black/10 hover:bg-black/5"
                aria-label="Copy secret"
              >
                {copied ? <Check size={14} className="text-county-green" /> : <Copy size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-black/50">
              Client ID: <code className="font-mono">{issued.clientId}</code>
            </p>
            <button type="button" onClick={() => setIssued(null)} className="text-[11px] font-bold text-black/40 hover:text-black/60">
              Dismiss
            </button>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Client name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Umoinner Sacco Integration" className="input text-xs" />
          </div>
          <div>
            <label className="label">Presents as (effective role)</label>
            <select value={effectiveRole} onChange={(e) => setEffectiveRole(e.target.value)} className="input text-xs">
              {EFFECTIVE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          {effectiveRole === "SACCO_OPERATOR" && (
            <div>
              <label className="label">Sacco</label>
              <select value={saccoId} onChange={(e) => setSaccoId(e.target.value)} className="input text-xs">
                <option value="">Select a Sacco…</option>
                {saccos.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Quota tier</label>
            <select
              value={quotaTier}
              onChange={(e) => setQuotaTier(e.target.value)}
              disabled={environment === "sandbox"}
              className="input text-xs disabled:opacity-50"
            >
              {Object.entries(quotaTiers).map(([tier, limit]) => (
                <option key={tier} value={tier}>{tier} ({limit})</option>
              ))}
            </select>
            {environment === "sandbox" && <p className="text-[10px] text-black/40 mt-1">Sandbox clients are always the sandbox tier.</p>}
          </div>
          <div>
            <label className="label">Environment</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEnvironment("sandbox")}
                className={`flex-1 text-xs font-bold py-1.5 rounded-lg border ${
                  environment === "sandbox" ? "bg-amber-100 border-amber-300 text-amber-800" : "border-black/10 text-black/50"
                }`}
              >
                Sandbox
              </button>
              <button
                type="button"
                onClick={() => setEnvironment("production")}
                className={`flex-1 text-xs font-bold py-1.5 rounded-lg border ${
                  environment === "production" ? "bg-county-blue/10 border-county-blue/30 text-county-blue" : "border-black/10 text-black/50"
                }`}
              >
                Production
              </button>
            </div>
          </div>
          <div>
            <label className="label">IP allowlist (optional)</label>
            <input
              value={ipAllowlistText}
              onChange={(e) => setIpAllowlistText(e.target.value)}
              placeholder="e.g. 203.0.113.0/24, 198.51.100.7"
              className="input text-xs"
            />
            <p className="text-[10px] text-black/40 mt-1">Comma-separated CIDRs/IPs. Leave blank for unrestricted.</p>
          </div>
        </div>

        <div>
          <label className="label">Scopes</label>
          <div className="flex flex-wrap gap-2">
            {scopes.map((s) => (
              <label
                key={s.scope}
                className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                  selectedScopes.includes(s.scope)
                    ? "bg-county-green/10 border-county-green/30 text-county-green"
                    : "border-black/10 text-black/60 hover:bg-black/5"
                }`}
                title={s.description}
              >
                <input type="checkbox" className="sr-only" checked={selectedScopes.includes(s.scope)} onChange={() => toggleScope(s.scope)} />
                {s.scope}
              </label>
            ))}
          </div>
        </div>

        {formError && <p className="text-xs text-county-red font-semibold">{formError}</p>}

        <ActionButton
          actionId="apiClient.create"
          target={name.trim() || "this client"}
          disabled={!name.trim()}
          onConfirm={async (reason, token) => {
            const input = buildInput();
            if (!input) return { error: formError || "Fix the form above first." };
            const result = await createApiClientAction(input, reason, token);
            if (result.error) return result;
            if (result.issued) {
              setIssued(result.issued);
              resetForm();
            }
            return {};
          }}
          className="btn-primary !w-auto px-4 py-2 text-xs font-bold"
        >
          Issue client
        </ActionButton>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm text-county-black">Active clients ({activeClients.length})</h3>
        {activeClients.length === 0 ? (
          <p className="text-xs text-black/40 italic">No API clients issued yet.</p>
        ) : (
          <div className="space-y-2">
            {activeClients.map((c) => (
              <ClientRow key={c.id} client={c} />
            ))}
          </div>
        )}
      </div>

      {revokedClients.length > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="font-bold text-sm text-county-black">Revoked ({revokedClients.length})</h3>
          <div className="space-y-2">
            {revokedClients.map((c) => (
              <ClientRow key={c.id} client={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
