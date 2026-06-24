# Reddably — Project Memory

Reddably is an out-of-network (OON) insurance billing platform for mental-health group
practices — practice admins overseeing multiple clinicians. Sibling product to Sessionably
(same founder, same stack). Differentiator vs. Mentaya: built for group practices, not solo
providers.

## Golden rules (do not violate)

- Mirror Sessionably's stack exactly. No frameworks. Vanilla HTML/CSS/JS only — no
  React / Vue / Next. One HTML file per view (e.g. `app.html`, `client-portal.html`).
- HIPAA-compliant. No PHI in URLs or query strings. PHI encrypted at rest (RDS,
  infra-level) and in transit. Audit-log PHI access.
- All network calls go through `window.ReddablyAPI` (`public/js/api-client.js`). Views
  never call `fetch()` directly.
- Use design tokens, never raw hex. Reference the semantic CSS variables from
  `public/app-foundation/styles/tokens.css`.
- Light mode only. A single "Ink & Oxblood" identity. No dark mode, no theme toggle.
- Auth token stored in `localStorage` under `reddably_access_token`.

## Stack

- Frontend: static, served by Vercel from the repo root. Assets live under `/public`.
- Backend: AWS Lambda + PostgreSQL (RDS) inside a VPC, behind `https://api.claimsub.com`.
  Deployed separately from Vercel.
- A few Stripe endpoints run as Vercel functions in `/api` — the Lambda VPC has no NAT
  egress, so it can't make outbound Stripe calls.
- Payments: Stripe + Stripe Connect. Per-claim platform fee of 5%, paid by the client or
  the practice (configurable, with per-clinician override).
- Domains: `reddably.com` (marketing), `app.reddably.com`, `api.claimsub.com`.

## Design system (F0 — "Ink & Oxblood")

- Primary oxblood `#7E3340` (hover `#652A35`); accent brass `#B08534`; ink `#1A1718`;
  warm paper background `#FAF7F3`.
- Body font: Inter. Display/headings: Source Serif Pro. Mono: JetBrains Mono.
- Calm and clinical — no urgency theater, no dopamine UI. Oxblood appears only where it
  earns attention (primary actions, active nav).
- Avoid blue/teal-primary + orange-accent — it reads as a healthcare-IT incumbent
  ("Availity-coded") and undermines the distinct identity.
- Token families: spacing `--space-1..11` (4px base), radius `--radius-1..pill`, shadow
  `--shadow-0..3`, motion `--motion-fast..ambient`, zones `--zone-0..3`, shell
  `--rail-width` / `--topbar-height` / `--content-max`.

## Repo layout

```
/                                  index.html (marketing), app.html (app shell)
/public/app-foundation/styles/     tokens.css, app.css
/public/styles/                    public-tokens.css
/public/js/                        api-client.js, app.js
/backend/                          AWS Lambda handlers + shared libs
/db/                               schema.sql (data model — source of truth), migrations/
/api/                              Vercel functions (Stripe checkout, etc.)
vercel.json                        clean URLs
```

## Data & code conventions

- PostgreSQL. UUID primary keys via `gen_random_uuid()`. `timestamptz` `created_at` /
  `updated_at`, with a shared `set_updated_at()` trigger.
- Prefer `text` + `CHECK` constraints over native `ENUM` types (easier to evolve).
- Money: `numeric(12,2)`. Percentages: `numeric(5,2)`.
- Soft-delete over hard-delete (`is_active` / `is_hidden`). Foreign keys default to
  `ON DELETE RESTRICT` to protect financial and PHI records. Keep an append-only
  `audit_log`.
- Multi-tenancy: carry `practice_id` on every practice-scoped table for query scoping and
  future row-level security.
- Vanilla JS: no build step, no bundler. Plain ES in `.js` files loaded via `<script>`.

## Group-practice model

- `practices` own `users` (role: `practice_admin` | `clinician` | `billing_staff`).
- A practice admin sees all clinicians, clients, and claims; a clinician is scoped to
  their own caseload.
- A client has one primary clinician but can be reassigned. Fee-payer is set at the
  practice level with a per-clinician override.

## Not in v1

AI/clinical notes, telehealth video, full EHR, and scheduling-as-a-feature (sessions exist
only to attach claims to). Those belong to Sessionably.

## Git workflow

- Never commit directly to `main`. Branch per task: `feat/…`, `fix/…`, `chore/…`.
- After completing a task: stage the relevant files, commit with a clear conventional
  message, push the branch, and open a PR with `gh pr create` (title + a short body that
  summarizes the change and how to test it). If `gh` is not authenticated, push the branch
  and tell the user the compare URL so they can open the PR on github.com.
- One PR per logical unit of work. Do NOT merge — the user reviews and merges.
- Never commit secrets; respect `.gitignore` (`.env*` etc.). Only `.env.example` is tracked.

## More context

@README.md @db/schema.sql
