FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time — they
# must arrive as build ARGs, not just runtime env vars, or the deployed app
# silently falls back to its localhost defaults (dead map, dead WebSockets).
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_TOMTOM_API_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_TOMTOM_API_KEY=$NEXT_PUBLIC_TOMTOM_API_KEY
# Used by robots.ts, sitemap.ts, and metadataBase for absolute URLs (link
# previews, OG images, sitemap entries) — confirmed live: without this ARG
# declaration the build silently bakes in the http://localhost:3000
# fallback despite the Render env var being set correctly, the same
# ARG-vs-runtime-env gap already documented above for the other three.
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# BACKEND_URL (no NEXT_PUBLIC_ prefix) is read server-side at request time by
# Server Components/Actions, not baked in — a dummy value here only lets the
# build's static analysis pass; the real value is supplied at runtime below.
ENV BACKEND_URL=http://127.0.0.1:8000

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["npm", "start"]
