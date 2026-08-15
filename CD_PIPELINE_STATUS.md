# CD Pipeline Status (Task 15)

ARCHITECTURE_DECISIONS.md §13/§14.4's target shape:

```
PR  →  lint + typecheck + unit + integration (Postgres/PostGIS) + migration check
    →  build & scan images  →  push to registry (immutable, git-SHA tagged)
    →  deploy to staging (automatic)  →  smoke tests
    →  deploy to production (manual approval)  →  canary 10%
    →  metric-gated promotion or automatic rollback
```

## Built and working

| Stage | Where |
|---|---|
| Lint/typecheck/unit (frontend) | `.github/workflows/ci.yml` `frontend` job (pre-existing) |
| Unit/boot-smoke (backend, SQLite) | `ci.yml` `backend` job (pre-existing) |
| Integration (Postgres/PostGIS) + migration up/down check | `ci.yml` `postgres-integration` job (Task 12) |
| Build & scan images | `ci.yml` `build-and-push` job — Docker Buildx, Trivy scan (report-only) |
| Push to registry, git-SHA tagged | Same job — pushes to `ghcr.io/<repo>/{backend,frontend}:<sha>` using the repo's built-in `GITHUB_TOKEN`, no extra registry secret needed |
| Blue/green mechanics for the stateless API tier | `docker-compose.canary.yml` (adds a second `backend_green` instance) + `nginx/nginx.canary.conf` (weighted upstream) + `scripts/canary-promote.sh` (health-gated weight shift, `<n>% → nginx -s reload`, zero-downtime including WebSockets) |

`scripts/canary-promote.sh` is genuinely runnable today against the self-hosted
docker-compose stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.canary.yml up -d
scripts/canary-promote.sh 10   # 90% blue / 10% green
scripts/canary-promote.sh 100  # full cutover
scripts/canary-promote.sh 0    # instant rollback
```

## Not built — genuinely blocked, not skipped

**Staging environment, automatic staging deploy, and an orchestrator to run blue/green
against in production.** All three need infrastructure this project doesn't have yet:

- **Staging**: Render's free tier is one service per app (`matatu-mms-backend`,
  `matatu-mms-frontend`) — there's no second environment to deploy to automatically.
  Creating one is an account/billing decision (a second Render service, or environment),
  not a code change.
- **Orchestrator** (§13.4's closing note: "an orchestrator provides all of this
  natively — hand-rolling blue/green in Docker Compose is possible but is largely
  reimplementing what the orchestrator gives free"). Kubernetes/ECS/Nomad would replace
  the docker-compose.canary.yml + nginx + shell-script approach above with native
  rolling-update/canary primitives. Standing one up is a real infrastructure project on
  its own, out of scope to bootstrap here.
- **Production manual-approval gate**: GitHub Environments support this natively
  (`environment: production` on a job, with required reviewers configured in repo
  settings) — genuinely just a repo-settings toggle once there's a real production
  deploy job to gate, which depends on the orchestrator/staging question above being
  settled first.

**What actually ships today**: this project's real production deployment is Render's own
git-push-to-deploy on the `deploy/render-demo` branch (`render.yaml`), which is simpler
than the pipeline above by design — appropriate for the current investor-demo stage, and
explicitly not what §13/§14 is describing (that section is written for the system at
higher scale/team-size, per its own opening framing in §2 — "at current team size the
distributed tax... buys nothing"). The pieces built here (image build/push/scan, blue/
green mechanics) are the concrete, reusable parts of that eventual pipeline; wiring them
into automatic staging/production deploys is real follow-up work once the
infrastructure decision above is made, not something to fake by pointing "staging" at
the same single Render service.
