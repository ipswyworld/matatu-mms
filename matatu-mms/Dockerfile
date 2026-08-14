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
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_TOMTOM_API_KEY=$NEXT_PUBLIC_TOMTOM_API_KEY
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

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["npm", "start"]
