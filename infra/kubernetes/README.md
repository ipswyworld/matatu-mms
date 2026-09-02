# Kubernetes manifests

Target-platform deployment for the post-Render production move
(Readiness List §1).

**These are not applied to anything today.** Render runs the current demo
from `render.yaml`, and nothing here is wired into that. They exist because
writing them is code work that can happen now, while provisioning the
cluster is procurement work that happens when the target cloud is chosen —
and because a migration plan written as manifests is reviewable in a way
that one written as prose is not.

## What is here

| File | Purpose |
|---|---|
| `namespace.yaml` | Namespace, resource quota, and default limits |
| `backend.yaml` | API Deployment, Service, HPA, PDB |
| `control-plane.yaml` | Ops control plane — no public ingress, by design |
| `worker.yaml` | ARQ worker, split out of the API process |
| `frontends.yaml` | Staff, public and ops apps |
| `ingress.yaml` | TLS termination and routing |
| `secrets.example.yaml` | Shape only — never real values |

## Decisions worth knowing before reading the YAML

**The worker is a separate Deployment.** It runs in-process today because
Render provides no second process type. Background job load (notifications,
report generation, webhook delivery) spikes on a completely different
schedule from web traffic, so scaling them together wastes money and still
lags. Splitting it is the first thing this migration buys.

**The control plane has no Ingress.** Per the Ops Console Rebuild Spec
§3.1, it exists so an operator can act when the main API is saturated. That
only holds if it is not sharing the same public path, and it must not be
reachable from the internet at all — access is via the ops app inside the
cluster, and the network-layer gate the readiness list calls the highest
outstanding security item.

**Probes distinguish liveness from readiness deliberately.** Liveness only
asks whether the process is alive; readiness asks whether dependencies are
reachable. Conflating them means a brief Postgres blip restarts every pod
simultaneously, turning a recoverable degradation into an outage.

**Migrations run as a Job, not an initContainer.** An initContainer runs per
pod, so a three-replica rollout would run `alembic upgrade head` three
times concurrently against the same database.

## What is deliberately absent

No service mesh, no operator, no GitOps controller. Each is defensible at a
larger scale and each is another system a small team has to operate during
an incident. Add them when there is a problem they solve, not preemptively.
