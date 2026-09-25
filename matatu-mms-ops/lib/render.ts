import { RenderServiceStatus, RenderIpAllowEntry } from "./types";

// A dedicated Render API key for this console, not the interactive CLI
// session token a developer already has locally — this one is meant to
// live as a deployed service's env var, so it needs to be independently
// revocable/scoped rather than tied to one person's login session.
// Generate at https://dashboard.render.com/u/settings#api-keys and set as
// RENDER_API_KEY on this service (matatu-mms-ops) in Render's dashboard.
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_API_BASE = "https://api.render.com/v1";

interface RawRenderService {
  id: string;
  name: string;
  serviceDetails?: { url?: string; ipAllowList?: RenderIpAllowEntry[] };
}

// View-only, deliberately: Render's write shape for ipAllowList (which
// field a PATCH /v1/services/{id} body actually needs) isn't confirmed
// against a live key from this codebase, and a malformed write to a
// security-critical access control is exactly the kind of mistake not
// worth risking blind. Render's own dashboard is the edit path until this
// has been verified end-to-end with a real RENDER_API_KEY.

interface RawRenderDeploy {
  status?: string;
  commit?: { id?: string; message?: string };
  finishedAt?: string;
  createdAt?: string;
}

async function renderFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${RENDER_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Render API ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * The last N deploys for one service, for the rollback picker — "which
 * deploy do you want to roll back to" needs a real list, not just the
 * currently-live one ServiceHealthMatrix already shows. Read-only, so it
 * stays in this file alongside getRenderServiceMatrix below; the actual
 * trigger/rollback writes live in the backend instead (see
 * backend/app/render_control.py) so they get the same require_reauth +
 * stage_audit_log every other Critical action in this console has — this
 * file has no re-auth or audit mechanism of its own to give them.
 */
export async function getRenderDeployHistory(serviceId: string, limit = 10): Promise<Array<{ id: string; status: string; commitId: string | null; commitMessage: string | null; finishedAt: string | null }>> {
  const raw = await renderFetch<Array<{ deploy?: RawRenderDeploy & { id?: string } } & RawRenderDeploy & { id?: string }>>(
    `/services/${serviceId}/deploys?limit=${limit}`
  );
  return raw.map((item) => {
    const d = item.deploy ?? item;
    return {
      id: (d as any).id ?? "",
      status: d.status ?? "unknown",
      commitId: d.commit?.id ?? null,
      commitMessage: d.commit?.message ?? null,
      finishedAt: d.finishedAt ?? d.createdAt ?? null,
    };
  });
}

/**
 * Service Health Matrix (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md A.3) — every
 * service under this Render account/workspace, with its currently-deployed
 * commit. Derived live from the Render API rather than a hand-maintained
 * list of service names, so it can't silently drift when a service is
 * added, renamed, or removed. Returns null (not an error) when
 * RENDER_API_KEY isn't set — this is a normal, expected state for a
 * freshly-provisioned ops console before someone's configured it, not a
 * failure to surface as a crash.
 */
export async function getRenderServiceMatrix(): Promise<RenderServiceStatus[] | null> {
  if (!RENDER_API_KEY) return null;

  // Render's REST API wraps list items as { cursor, service: {...} } —
  // unwrap defensively in case that shape ever changes to a flat array.
  const raw = await renderFetch<Array<{ service?: RawRenderService } & RawRenderService>>("/services?limit=50");
  const services = raw.map((item) => item.service ?? item);

  const withDeploys = await Promise.all(
    services.map(async (svc): Promise<RenderServiceStatus> => {
      try {
        const deploys = await renderFetch<Array<{ deploy?: RawRenderDeploy } & RawRenderDeploy>>(
          `/services/${svc.id}/deploys?limit=1`
        );
        const deploy = deploys[0]?.deploy ?? deploys[0];
        return {
          id: svc.id,
          name: svc.name,
          url: svc.serviceDetails?.url ?? null,
          deployStatus: deploy?.status ?? null,
          commitId: deploy?.commit?.id ?? null,
          commitMessage: deploy?.commit?.message ?? null,
          deployedAt: deploy?.finishedAt ?? deploy?.createdAt ?? null,
          ipAllowList: svc.serviceDetails?.ipAllowList ?? [],
        };
      } catch {
        // One service's deploy history failing to load shouldn't blank out
        // the whole matrix — show it with unknown deploy info instead.
        return { id: svc.id, name: svc.name, url: svc.serviceDetails?.url ?? null, deployStatus: null, commitId: null, commitMessage: null, deployedAt: null, ipAllowList: svc.serviceDetails?.ipAllowList ?? [] };
      }
    })
  );

  return withDeploys.sort((a, b) => a.name.localeCompare(b.name));
}
