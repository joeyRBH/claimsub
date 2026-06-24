# Reddably

Out-of-network (OON) insurance billing for mental-health **group practices** — practice
admins overseeing multiple clinicians. Sibling product to Sessionably (same stack).

> Project conventions and golden rules live in [`CLAUDE.md`](CLAUDE.md). Read it first.

## Stack

- **Frontend** — static, vanilla HTML/CSS/JS (no frameworks, no build step), served by
  Vercel from the repo root. Assets under `/public`. All network calls go through
  `window.ReddablyAPI` (`public/js/api-client.js`).
- **Backend** — AWS Lambda + PostgreSQL (RDS) inside a VPC, behind
  `https://api.claimsub.com`. Deployed **separately** from Vercel. See
  [`backend/README.md`](backend/README.md).
- **Database** — PostgreSQL; `db/schema.sql` is the source of truth, applied to RDS
  separately. See [`db/README.md`](db/README.md).
- **Payments** — Stripe + Stripe Connect; a few Stripe endpoints run as Vercel functions
  in `/api` (the Lambda VPC has no NAT egress).

## Layout

```
/                       index.html (marketing), app.html (app shell)   [to come]
/public/                static assets — js/api-client.js, styles, tokens
/backend/               AWS Lambda handlers + shared libs (auth, db, jwt, ...)
/db/                    schema.sql (source of truth) + migrations/
/api/                   Vercel functions (Stripe checkout, etc.)         [to come]
```

## Status

Foundation in progress: PostgreSQL schema, the `window.ReddablyAPI` client foundation, and
core auth (register / login / me) Lambda handlers. Design system, app shell, and marketing
site land next.

## Deployment notes

- The database schema (`db/schema.sql`) is applied to RDS separately — see
  [`db/README.md`](db/README.md).
- The Lambda backend deploys separately from the Vercel frontend — see
  [`backend/README.md`](backend/README.md).
- Secrets come from the environment only and are never committed (`.env*` is gitignored;
  only `.env.example` templates are tracked).
