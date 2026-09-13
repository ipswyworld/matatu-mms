# Argo CD

GitOps continuous deployment for the [Kubernetes manifests](../kubernetes/)
— **not applied to anything today**, for the same reason those manifests
aren't: there is no live cluster yet. Render runs the current demo via its
own native git-push auto-deploy, watching `deploy/render-demo` directly;
nothing here is wired into that, and nothing here should be applied until
a real target cluster exists. See [`../kubernetes/README.md`](../kubernetes/README.md)
for why these two deploy paths are deliberately separate rather than one
replacing the other.

## Why this exists now, when the sibling directory's own README said not to

`infra/kubernetes/README.md` originally said: *"No service mesh, no
operator, no GitOps controller... add them when there is a problem they
solve, not preemptively."* That was the right call when it was written —
there was no CI image-publishing pipeline worth deploying from yet. That
has changed: `.github/workflows/ci.yml`'s `build-and-push` job has been
building and pushing real, git-SHA-tagged images to GHCR on every merge to
`master` for a while now, with nothing downstream ever consuming them —
the images were built and simply sat in the registry. Argo CD is the
missing other half of a pipeline that already does the first half; adding
it here is closing a real, already-existing gap, not staging tooling
ahead of a need.

## What's here

| File | Purpose |
|---|---|
| `project.yaml` | AppProject — scopes what the Application below may touch (this repo, the `matatu-mms` namespace only) |
| `application.yaml` | The actual GitOps link: tracks `master`, syncs `infra/kubernetes/` via Kustomize, automated with prune + selfHeal |

## How a deploy actually happens

1. A PR merges to `master`. `.github/workflows/ci.yml` runs `build-and-push`: builds all four images (backend, frontend, frontend-public, frontend-ops) with real production build-args, tags each `:<git-sha>` and `:latest`, pushes to `ghcr.io/ipswyworld/matatu-mms/<name>`, scans for vulnerabilities (advisory).
2. `update-gitops-manifests` (same workflow, runs after `build-and-push`) runs `kustomize edit set image` against `infra/kubernetes/kustomization.yaml`, pinning all four images to this commit's SHA, and pushes that as a new commit — tagged `[skip ci]` so it doesn't re-trigger the workflow against itself.
3. Argo CD's `matatu-mms` Application (already polling `master` — default 3-minute interval, or immediately via a configured GitHub webhook, see Bootstrap step 4) detects the new commit, computes the diff, and syncs automatically (`syncPolicy.automated`): applies the changed Deployments, runs the `mms-migrate` Job as a PreSync hook first (`argocd.argoproj.io/hook: PreSync` — see `control-plane-and-worker.yaml`), then rolls the Deployments.
4. Argo CD's own UI/CLI (`argocd app get matatu-mms`, or the dashboard) is the place to watch rollout health and roll back — not `kubectl`, which would just get reverted by `selfHeal` on the next reconcile.

No step above involves a person or a script running `kubectl apply` — that's the actual point of GitOps: the cluster's state is a pure function of what's committed to `master`, and the only supported way to change what's running is a commit.

## Bootstrap, once a real cluster exists

1. Install Argo CD itself into the target cluster (`kubectl create namespace argocd && kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml`) — this is the one piece of infrastructure this repo cannot provision for you, since it's cluster setup, not application deployment.
2. Create the real secrets (`infra/kubernetes/secrets.example.yaml` is a shape-only template — never apply it as-is) in the `matatu-mms` namespace, **before** the first Argo sync. Argo CD does not create these; `kustomization.yaml` deliberately excludes them from its managed resources for exactly this reason (see that file's header comment) — sync without them first means every Deployment sits in CrashLoopBackOff/ImagePullBackOff waiting on a Secret that doesn't exist.
3. Apply this directory: `kubectl apply -f infra/argocd/project.yaml -f infra/argocd/application.yaml` (once, by hand — bootstrapping Argo CD's own config is the one legitimate exception to "everything is a git commit," since nothing manages Argo CD's own Application/AppProject resources yet at that point).
4. Optional but recommended: configure a GitHub webhook (repo Settings → Webhooks → Payload URL `https://<your-argocd-host>/api/webhook`) so a push to `master` triggers an immediate sync instead of waiting for Argo's default 3-minute poll.
5. Point `infra/kubernetes/ingress.yaml`'s four hostnames at the cluster's ingress controller's external IP/load balancer, and provision TLS for `mms-tls` (cert-manager's `ClusterIssuer` is the common choice — see `ingress.yaml`'s header comment for why that's not wired here).
