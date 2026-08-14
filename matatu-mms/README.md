# NCCG Matatu Management System

A Next.js 14 (App Router + TypeScript + Tailwind) prototype for Nairobi City County
Government to track matatu (PSV) fleet compliance, activity, and fines, with
role-based access control (RBAC).

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000 — you'll be redirected to `/login`.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@nairobi.go.ke | admin123 |
| Enforcement Officer | enforcement@nairobi.go.ke | enforce123 |
| Sacco Operator | operator@umoinner.co.ke | sacco123 |
| Viewer / Executive | viewer@nairobi.go.ke | viewer123 |

## Roles & permissions (see `lib/rbac.ts`)

- **Admin** — full access: registry, activity, fines, routes, and user/role management.
- **Enforcement Officer** — registers vehicles, logs trip/inspection/incident activity, issues fines.
- **Sacco Operator** — sees only their own fleet, activity and fines; can dispute a fine.
- **Viewer / Executive** — read-only across the system (e.g. county leadership, auditors).

Route access is enforced in `middleware.ts` (login required everywhere; `/users` is
admin-only) and each mutation is re-checked server-side in `lib/actions.ts`, so the
UI hiding a button is a convenience, not the security boundary.

## What's included

- **Dashboard** — fleet, flagged/impounded vehicles, pending fines and their value, recent activity.
- **Matatu Registry** — register vehicles, view detail (fleet status, inspection date), change
  status (Active / Flagged / Impounded / Decommissioned).
- **Routes** — the route network and vehicle counts per route.
- **Activity Log** — trip, inspection and incident entries per vehicle.
- **Fines** — issue a fine against a vehicle, mark paid, waive, or (as a Sacco) dispute.
- **Users & Roles** — admin-only user management.

## Data layer

`lib/data.ts` is an in-memory, seeded data store (kept on `globalThis` so it survives
Next.js dev hot-reload). It's intentionally structured so a real database is a drop-in
replacement — swap the functions in that file for Prisma/Postgres (or your DB of choice)
and nothing else in the app needs to change.

## Before production

This is a functional prototype, not a hardened deployment. Before rolling this out for
real NCCG operations:

1. **Persistence** — replace `lib/data.ts` with a real database (Prisma + Postgres recommended).
2. **Auth** — replace the base64 session cookie in `lib/session.ts` with a signed/encrypted
   session (NextAuth, iron-session, or signed JWTs), and hash passwords (bcrypt/argon2) instead
   of storing them in plaintext.
3. **Audit trail** — fine status changes and vehicle status changes should be logged with
   who/when for accountability, not just overwritten.
4. **County branding** — the green/red palette in `tailwind.config.ts` and `app/globals.css`
   approximates NCCG colours; swap in the exact brand hex codes and the official crest/logo
   asset once available.
5. **Payments** — fines are marked "Paid" manually here; a real deployment would integrate
   a NairobiPay payment confirmation webhook.
