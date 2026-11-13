# Development guide

For humans and AI agents continuing this repository.

## Prerequisites

- Node.js 22+ (20+ may work; 24 is fine)
- npm
- **PostgreSQL is not required to run unit/isolation tests.** Tests use [PGlite](https://pglite.dev/) (in-process PostgreSQL).
- Optional: a local PostgreSQL 16+ for manual exploration and
  `npm run test:postgres`. Do not install PostgreSQL automatically.

Do not use production credentials. Do not install Docker as a requirement.

## Install

```bash
cd Code
npm install
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run build` | Next.js production build |
| `npm run dev` | Next.js dev server |
| `npm run db:migrate` | Apply SQL migrations to `MIGRATION_DATABASE_URL`, then pin/assert `gaming_app` (fails closed if unsafe) |
| `npm run test:postgres` | Real PostgreSQL security suite (disposable `gaming_center_security_test` only). Fail-closed if unset or if reset is not allowed. |
| `npm run test:supabase` | Hosted Supabase compatibility suite (dedicated TEST project). Fail-closed. Never point `test:postgres` at Supabase. |

## Configuration

See `Code/.env.example`. Never commit `.env`.

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | `development` / `test` / `production` |
| `DATABASE_URL` | Runtime request connection as `gaming_app` (`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN`). Leave unset for PGlite tests. |
| `MIGRATION_DATABASE_URL` | Privileged connection for `npm run db:migrate` only. Never used for HTTP. Must be able to `ALTER ROLE gaming_app`, or `gaming_app` must already be pinned — otherwise migrate fails closed. |
| `RUNTIME_DB_ROLE` | Optional; default `gaming_app`. Must remain equivalently restricted. |
| `APP_BASE_URL` | Public origin (Better Auth + mutation Origin checks). **Required in production**; no localhost default. |
| `BETTER_AUTH_SECRET` | Session-cookie signing secret. Required in production (≥ 32 characters). |
| `GAMING_TEST_DATABASE_URL` | Privileged URL for `npm run test:postgres`. Database name must be `gaming_center_security_test`. |
| `GAMING_TEST_RUNTIME_DATABASE_URL` | Optional `gaming_app` URL for those tests |
| `GAMING_TEST_ALLOW_RESET` | Must be the literal `true` before the live suite wipes schema. Missing/mismatched fails closed. |
| `GAMING_SUPABASE_PROJECT_REF` | Required on Vercel. Must match the pooler username / direct hostname. Active backend is `DATABASE_URL` (`CONNECTION_MODES`). A leftover ref does not force local PostgreSQL into Supabase mode. |
| `GAMING_PREVIEW_DB_OK` | Vercel Preview only: must be `true` after Preview uses a non-production database. Does not authorize copying Production `DATABASE_URL`. |
| `DATABASE_POOL_MAX` | Optional runtime postgres.js pool (1–4, default 2). |
| `GAMING_SUPABASE_TEST_*` | Hosted `npm run test:supabase` only. See `docs/operations/VERCEL_SUPABASE_DEPLOYMENT.md`. |
| `GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN` | Optional. Server-only. When set (≥16 characters), enables **one-time** HTTP first-owner sign-up via `/setup` and header `x-gaming-bootstrap-token`. Unset/empty **disables** public HTTP sign-up. Not required for production startup after bootstrap. Never `NEXT_PUBLIC_*`. |

`NODE_ENV=test` must never point at production.

## Identity & authorization (Milestone 2)

Read `docs/architecture/IDENTITY.md`, ADR 0007, and ADR 0008 before touching
auth, RLS, or admin code. Rules of thumb:

- Better Auth is imported only inside `src/auth`. Domain code receives an
  `OrganizationActor` from the authorization pipeline.
- Every privileged use-case lives in `src/modules/identity` and enforces its
  permission itself (`assertPermission`), inside `withTenant`, with an audit
  record in the same transaction.
- Route handlers stay thin: zod-parse → `requireOrganization()` → use-case.
- New permission codes are seeded by migration; decide OWNER-role backfill
  explicitly per code.

## Migrations

1. Add a new numbered SQL file in `drizzle/` (`0002_….sql`, …).
2. Put purpose in a header comment.
3. Include tables, FKs, CHECKs, indexes, RLS if tenant data.
4. Add tests (isolation if tenant-owned).
5. Apply on a **disposable** database. Do not run DROP/TRUNCATE against shared data without explicit human approval.

Do not create `cards_*` migrations.

## Tenant isolation

- Session has `organizationId` (and branch access list).
- `withTenant(organizationId, fn)` opens a transaction and
  `set_config('app.organization_id' / 'app.user_id', …, true)`. There is no
  `app.bypass_rls` skip.
- Client headers cannot override the session organization.
- Composite FKs block cross-org relations even if application code bugs out.
- Future branch-scoped operations must call `assertBranchAccess`.

## Real PostgreSQL security verification

`npm test` uses PGlite and never opens real PostgreSQL. PGlite does not
perfectly reproduce PostgreSQL roles/locking. To verify on a real server
(disposable database only):

1. PostgreSQL 16+ listening locally (do not auto-install).
2. Create **only** the disposable database `gaming_center_security_test` and
   roles: table owner for migrations (`MIGRATION_DATABASE_URL` /
   `GAMING_TEST_DATABASE_URL`), `gaming_app` LOGIN with password,
   `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`.
  3. Grant `gaming_app` usage + DML on public tables (migrations 0001–0012 do
   this when applied as a privileged role). Migration `0004` fails closed if
   `gaming_app` cannot be pinned and is still unsafe. `npm run db:migrate`
   repeats that catalog check after SQL. Migration `0010` revokes runtime DELETE
   on audit and archive-only masters. Migration `0011` is a no-op locally when
   Supabase Data API roles do not exist. Additive `0013_prorated_hour_billing.sql`
   adds `time_billing_mode` (default UNIT) so legacy CEIL/FLOOR/NEAREST plans stay
   deterministic; apply it on disposable local Postgres before smoke. Do not apply
   0013 to hosted Supabase until a human authorizes it.
4. Set:
   - `GAMING_TEST_DATABASE_URL` — privileged, database name **must** be
     `gaming_center_security_test`
   - `GAMING_TEST_ALLOW_RESET=true` — explicit opt-in to wipe **that**
     database’s `public` schema so the suite is repeatable
   - optionally `GAMING_TEST_RUNTIME_DATABASE_URL` (`gaming_app`)
5. `cd Code && npm run test:postgres`  
   A second `npm run test:postgres` must also pass (the harness resets the
   approved disposable database first).

The live harness **refuses** destructive cleanup unless:

- the URL database name is exactly `gaming_center_security_test`
- `current_database()` matches that name after connect
- `GAMING_TEST_ALLOW_RESET=true`
- the name is not `postgres`, `template0`, or `template1`

Reachability is not treated as proof a database is disposable. The harness
never issues `DROP DATABASE` and never connects to `postgres` / `template0`
/ `template1` to reset another database.

If PostgreSQL is not available, treat real role/locking verification as
**BLOCKED BY ENVIRONMENT**. Do not claim it passed on PGlite alone.

## CSRF assumptions

Admin APIs are same-origin JSON. Cookies are SameSite=Lax, HttpOnly, and Secure
in production. Mutation routes require a matching `Origin`. In production,
missing Origin is denied and `APP_BASE_URL` has no localhost default. This is
not token-based CSRF. Before any cross-origin admin client or non-JSON cookie
mutation, add a new ADR (ADR 0008).

Pilot operations docs: `docs/operations/PILOT_RUNBOOK.md`,
`DEPLOYMENT_RUNBOOK.md`, `BACKUP_RESTORE.md`, `PILOT_CHECKLIST.md`,
`VERCEL_SUPABASE_DEPLOYMENT.md`.

## Adding a feature safely

1. Read the matching `Requirements/*.md` file and `GAMING_CENTER_BLUEPRINT.md`.
2. If the item is **NEEDS DECISION** or Future Cards/NFC, stop.
3. Put domain logic in the owning module, not in a page.
4. Migrate + test + typecheck + lint.

## Needs Decision

Search ADRs and Requirements for `NEEDS DECISION`. Do not invent product behavior, vendors, or irreversible schema.

## Do not implement yet

POS catalog, inventory, Cards/NFC, loyalty, membership, reservations, tournaments, offline sync, WebSocket floor transport, cash shifts, refunds, provider payment APIs.

## Customer contact normalization (Milestone 3)

- **Email:** trim, lowercase; empty becomes null. Stored in `email_normalized`.
- **Phone:** trim; strip spaces, dashes, dots, and parentheses; optional leading `+`; 6–15 digits. Stored in `phone_normalized`. Empty becomes null.
- **Name / notes / code:** trim; empty optional fields become null.
- Name, phone, and email are **not** unique (FUN-006). Matching phone or email on a non-archived customer produces a non-blocking `warnings` array. Records are never merged automatically.

## Recommended next milestone

**UX / Product Consolidation Pass is IN DEVELOPMENT** until browser verification. **Platform adaptation (Vercel + Supabase) is IN DEVELOPMENT.** Complete hosted Supabase + Vercel verification before real-money GO. Milestone 8 remains CLOSED. Do not start Milestone 9 (POS catalog / inventory) until a human explicitly authorizes it. Do not run `npm run test:supabase` against a hosted database that contains the real first owner.

UX product rules: `docs/architecture/UX_PRODUCT.md`. Simplicity-first, auto-generated internal codes, Gaming Center Setup Wizard (not `/setup` bootstrap), bulk devices, friendly pricing adapter that maps exactly onto existing TIME_BASED semantics.
