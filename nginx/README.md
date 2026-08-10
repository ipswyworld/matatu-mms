# nginx reverse proxy

`nginx.conf` fronts both the FastAPI backend (port 8000) and the Next.js
frontend (port 3000) behind one edge: TLS termination, rate limiting, gzip,
security headers, and WebSocket upgrade support for GPS telemetry and the
live dashboard feed.

## Certificates

`certs/dev-selfsigned.crt` / `dev-selfsigned.key` are a **local-development-only**
self-signed pair (1 year validity, generated for `CN=localhost`). Browsers
will show a certificate warning — that's expected for local testing.

**Before this ever serves real traffic**, replace both files with a real
certificate:

- **Let's Encrypt (recommended, free, auto-renewing)**: run certbot against
  this nginx (webroot mode using the `/.well-known/acme-challenge/` location
  already wired into the HTTP server block), then point
  `ssl_certificate`/`ssl_certificate_key` at the issued cert instead of the
  dev files.
- **A commercial/CA-issued cert**: drop the `fullchain.pem`/`privkey.pem`
  equivalents in and update the same two directives.

Never commit the real private key to source control — `certs/*.key` is
already in `.gitignore`.

## Rate limiting

Three zones, tuned for this system's actual traffic shape:
- `auth_zone` (5 req/s/IP) — login/register, the highest-value brute-force target.
- `public_zone` (20 req/s/IP) — unauthenticated endpoints (offender fine
  lookup/payment, Sacco onboarding) — looser than auth, still bounded.
- `general_zone` (60 req/s/IP) — everything else.

Adjust these numbers based on real traffic once you have production data —
they're reasonable starting points, not measured limits.

## Testing the config

```bash
docker run --rm -v "$(pwd)/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$(pwd)/proxy_params.conf:/etc/nginx/proxy_params.conf:ro" \
  -v "$(pwd)/certs:/etc/nginx/certs:ro" \
  nginx:alpine nginx -t
```

Or, once the full stack is up via the project's `docker-compose.yml`:

```bash
docker compose exec nginx nginx -t
```
