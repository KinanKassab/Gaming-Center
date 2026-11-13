# Vercel + Supabase PostgreSQL deployment

Platform adaptation of the closed M1–M8 system. **Not** a product milestone. Milestone 9 (POS / inventory) is not started.

Supabase is **managed PostgreSQL** for this product. Do not use Supabase Auth, the browser Data API, Realtime, or Storage for M1–M8.

## Architecture

```
Browser
  → HTTPS
Vercel (Next.js 15 Node.js Functions, Better Auth, existing HTTP authorization)
  → Supavisor Transaction Pooler (port 6543)
  → PostgreSQL role gaming_app (NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN)
  → Supabase PostgreSQL (existing schema, FORCE RLS, financial invariants)
```

Separate operational connections:

| Purpose | Path | Role |
| --- | --- | --- |
| **Runtime** (`DATABASE_URL`) | Vercel → Supavisor transaction pooler `:6543` | `gaming_app` (`gaming_app.<project-ref>` in the URL) |
| **Migration** (`MIGRATION_DATABASE_URL`) | Operator/CI → direct `db.<ref>.supabase.co:5432`, or session pooler `:5432` if IPv4 requires it | Privileged migration role |
| **Backup** | Out-of-band `pg_dump` → direct PostgreSQL | Dedicated **BYPASSRLS** backup role. Never Vercel. Never `gaming_app`. |

Do **not** run migrations or `pg_dump` from request-serving Vercel Functions.

## Region

Target colocation (verify in each dashboard when creating the project):

- Supabase: Ireland / `eu-west-1` (actual TEST project region)
- Vercel Functions: `dub1` (set in `Code/vercel.json` `regions` and `src/app/layout.tsx` `preferredRegion`)

Do not leave Vercel on default `iad1` while Supabase is in Ireland. If a later project is created in a different Supabase region, change both Vercel region settings to match.

## Vercel project

| Setting | Value |
| --- | --- |
| Root Directory | `Code` (application source stays under `Code/`; do not move it) |
| Framework | Next.js (auto) |
| Install | `npm install` |
| Build | `npm run build` |
| Output | Next.js default (`.next`) |
| Node.js | 20.x or 22.x (`package.json` engines `>=20`) |
| Function region | `dub1` to colocate with Ireland / `eu-west-1` |

Hobby may be used for development, technical deployment testing, and non-commercial demo/staging. **Hobby is not approved for a real commercial Gaming Center.** Commercial production plan remains a separate decision. Do not change product behavior based on plan.

## Environment matrix

Never prefix secrets with `NEXT_PUBLIC_`. Never expose these to the browser.

| Variable | Development | Preview | Production | Migration-only | Notes |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Local `gaming_app` on PostgreSQL 18 | Dedicated **non-production** Supabase transaction pooler `gaming_app.<ref>` `:6543` | Production Supabase transaction pooler `gaming_app.<ref>` `:6543` | No | Authoritative role is still `current_user = gaming_app` |
| `MIGRATION_DATABASE_URL` | Local privileged URL | Same Preview project, **direct or session pooler**, never `:6543` | Production direct or session pooler | Yes | Never equal to `DATABASE_URL`. Not used by Functions |
| `BETTER_AUTH_SECRET` | Optional locally | Unique ≥32 chars | Unique ≥32 chars | No | Per environment; do not copy Production into Preview |
| `APP_BASE_URL` | `http://localhost:3000` | Optional; otherwise `https://$VERCEL_URL` | Exact HTTPS production origin | No | Production: no localhost default |
| `GAMING_SUPABASE_PROJECT_REF` | Optional | Required on Vercel | Required on Vercel | No | Must match pooler username / `db.<ref>.supabase.co` |
| `GAMING_PREVIEW_DB_OK` | Unset | Must be `true` | Unset | No | Preview refuses to start without it |
| `DATABASE_POOL_MAX` | Optional 1–4 | Optional 1–4 | Optional 1–4 | No | Default **2**. Cap **4**. Supavisor already pools |
| `RUNTIME_DB_ROLE` | Default `gaming_app` | Do not change | Do not change | No | Catalog role name, not the pooler username |
| `GAMING_TEST_*` | Local disposable DB only | Unset | Unset | No | Never point `test:postgres` at Supabase |
| `GAMING_SUPABASE_TEST_*` | Hosted test project only | Unset on app deploys | Unset on app deploys | Test CI | See hosted tests below |
| `GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN` | Optional local | Optional; remove after first owner | Optional; **remove after first owner** | No | Server-only. ≥16 chars when set. Unset = public HTTP sign-up disabled. Never `NEXT_PUBLIC_*`. Do not log. |

### First-owner bootstrap (hosted)

Do **not** insert rows into `auth_users` / `auth_accounts` / `auth_sessions` / `auth_verifications`. Do **not** use Supabase Auth.

Operator lifecycle:

1. Set `GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN` on the Vercel environment (Production or Preview) to a long random secret. Generate locally (do not paste examples of real secrets into tickets or git). Never prefix with `NEXT_PUBLIC_`.
2. Deploy. Confirm `/api/health/live` and `/api/health/ready`.
3. Open `/setup` on the public origin. Submit display name, email, password, and the bootstrap token (sent as header `x-gaming-bootstrap-token`, never as a query string).
4. Sign-in follows automatically from that form; you should land on `/admin`.
5. Create the initial organization (slug, name, currency, timezone, locale). You become OWNER with the current permission catalog.
6. Confirm Admin → Users shows your membership as ACTIVE with role OWNER.
7. Remove `GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN` from Vercel.
8. Redeploy.
9. Prove public sign-up is denied: `POST /api/auth/sign-up/email` without the token (and with any leftover token) returns forbidden/conflict. `/login` shows Sign in only.
10. Create later staff only from Admin → Users (`POST /api/memberships` `mode=create`). They must not be able to `POST /api/organizations`.

If the token is missing, HTTP first-user sign-up is disabled even on an empty database. After the first Core User exists, HTTP sign-up stays closed even if the token is still configured.

Migration `0012_platform_bootstrap.sql` must be applied (`npm run db:migrate` with `MIGRATION_DATABASE_URL`) before bootstrap. It is forward-only.

### Preview isolation

Vercel Preview `NODE_ENV` is `production`. Preview must never reuse Production `DATABASE_URL`.

In the Vercel dashboard, configure **Preview** env vars separately. Do not enable “copy Production to Preview” for database URLs. Set `GAMING_PREVIEW_DB_OK=true` only after Preview points at a dedicated non-production Supabase project.

Code fail-closed: Preview deployments refuse to start unless `GAMING_PREVIEW_DB_OK=true`. That flag is an operator acknowledgement, not a detector of Production URLs.

### Production `APP_BASE_URL` and CSRF

- Vercel Production: `APP_BASE_URL` must be the canonical `https://` origin. Better Auth `trustedOrigins` and mutation `Origin` checks use that origin only. `VERCEL_URL` (`*.vercel.app`) is **not** added in Production.
- Vercel Preview: `Origin` may match `APP_BASE_URL` (if set) plus Vercel-provided `VERCEL_URL` / `VERCEL_BRANCH_URL` (`*.vercel.app` only). `Host` and `X-Forwarded-Host` are never trusted.
- Missing `Origin` on mutations is still denied when `NODE_ENV=production` (including Preview).

## Supabase project settings

1. Create a project in the region that matches Vercel (Ireland / `eu-west-1`).
2. **Disable the Data API** (REST/GraphQL) in Dashboard if the project UI offers a full disable. This app does not use it.
3. Do not enable Supabase Auth for this product. Better Auth + `auth_users` remain canonical.
4. Do not put `anon` / `service_role` keys in Vercel. Runtime uses `gaming_app` over the PostgreSQL wire protocol only.
5. Do not install `@supabase/supabase-js` unless a future decision requires a non-Postgres Supabase product.

Migration `0011_supabase_platform_hardening.sql` revokes `anon` / `authenticated` / `service_role` privileges on **public** application objects when those roles exist. It is a no-op on ordinary local PostgreSQL. It does not touch `auth` / `storage` / `realtime` schemas.

If default privileges for objects created by a Dashboard-owned role still grant to `anon`, set that in the Dashboard (or disable Data API). Do not invent `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` from a migration role that cannot do it.

## Database roles

| Role | Use |
| --- | --- |
| `gaming_app` | Request path only. Pinned `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN` |
| Migration / `postgres` (Supabase) | `npm run db:migrate` only. Must be able to `ALTER ROLE gaming_app` or the role must already be pinned (0004 fails closed) |
| Dedicated backup role | Future. `BYPASSRLS`, least privilege, never in Vercel or the browser |
| `anon` / `authenticated` / `service_role` | Platform roles. Not used for application data access |

After `CREATE ROLE gaming_app` (migration 0001), set a password before using the pooler:

```sql
ALTER ROLE gaming_app WITH PASSWORD '...';
```

Do not weaken `gaming_app`. If hosted Supabase refuses a role-management statement in 0001/0004, **stop** and treat it as a platform incompatibility — do not bypass the pin.

Pooler URL username `gaming_app.<project-ref>` must map to PostgreSQL `current_user = gaming_app`. `getSafeRuntimeDb()` verifies catalog attributes. If it does not map, the app fails closed.

## Prepared statements and pooling

- Runtime postgres.js uses `prepare: false` in **all** environments (transaction pooler does not support prepared statements; local PostgreSQL accepts simple queries).
- Runtime client pool default `max: 2` (optional `DATABASE_POOL_MAX`, cap 4). Each Vercel instance must not open a large driver pool; Supavisor pools server-side. Concurrent cashiers are concurrent Function invocations, not one serialized process.
- Transaction pooler (`:6543`): runtime only.
- Session pooler (`:5432` on `*.pooler.supabase.com`): migration fallback when direct IPv6 is unavailable. Not for `pg_dump`.
- Direct (`db.<ref>.supabase.co:5432`): preferred for migrations and backups.

## Migration procedure

1. Use `MIGRATION_DATABASE_URL` (direct or session pooler). Never transaction pooler.
2. From a laptop or CI (not a Vercel request): `cd Code && npm run db:migrate`
3. Confirm migrate output and `gaming_app` pin.
4. Apply 0001→0011 against a **clean dedicated Supabase TEST project** before Production.
5. Then deploy the app.

`npm run db:migrate` refuses a transaction-pooler migration URL.

## Backup

See `BACKUP_RESTORE.md`. Additional Supabase rules:

- Runtime URL is not a valid backup credential.
- Transaction pooler is not a backup connection (`pg_dump` is rejected).
- On Free/Staging, provider snapshots are not assumed. External encrypted dumps remain required before real-money use. Verify plan backup capability at deployment time; do not claim PITR exists without checking the plan.

## Health

- `GET /api/health/live` — Function invocation succeeded.
- `GET /api/health/ready` — Function → Supavisor → `gaming_app` → `getSafeRuntimeDb()` + `SELECT 1`. Generic body.

## Hosted test procedure

Do **not** point `npm run test:postgres` at Supabase. That suite is tied to disposable `gaming_center_security_test`.

```bash
cd Code
# Dedicated TEST project only:
# GAMING_SUPABASE_TEST_DATABASE_URL=...          # direct or session pooler
# GAMING_SUPABASE_TEST_RUNTIME_DATABASE_URL=...  # transaction pooler gaming_app.<ref>
# GAMING_SUPABASE_TEST_PROJECT_REF=...
# GAMING_SUPABASE_TEST_ALLOW_MUTATION=true
npm run test:supabase
```

The suite fails closed if those values are missing, hosts are not Supabase, project refs diverge, runtime is not the transaction pooler, or the mutation flag is not `true`. It resets **public** application objects only. It never issues `DROP DATABASE` and never drops `auth` / `storage` / `realtime`.

## Deployment procedure

1. Provision Supabase TEST project; run 0001–0011; set `gaming_app` password; confirm pin.
2. Run `npm run test:supabase` against that TEST project.
3. Configure Vercel Root Directory `Code`, region `dub1`, Node 20/22.
4. Set Production vs Preview env vars separately (matrix above).
5. `npm run db:migrate` against the target database (not from Functions).
6. Deploy. Hit `/api/health/live` then `/api/health/ready`.
7. Smoke: first-owner `/setup` (if the database is empty), sign-in, create the initial organization, org select, floor, a zero-value operational path. Then remove `GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN` and redeploy. Confirm `POST /api/auth/sign-up/email` is denied.

Do not deploy Production until hosted TEST verification has passed.

## Rollback

Same as `DEPLOYMENT_RUNBOOK.md`: roll the **app** independently of schema. No down-migrations. Do not truncate financial history. Restore uses the backup role onto a designated target, not `gaming_app`.

## Free-tier restrictions (verify at deploy time)

Typical Supabase Free / Vercel Hobby limits that affect this architecture:

- Pause / compute limits; connection and pooler caps
- No assumed PITR or production-grade backups
- Vercel Hobby execution time and concurrency limits (pilot reports are capped at 31 days; do not treat Hobby as commercial production)
- IPv6-only direct connections: use session pooler for migrations if the operator network is IPv4-only

## Local PostgreSQL

Local development is unchanged: PostgreSQL 18, `gaming_center_security_test`, `gaming_app`, `npm run test:postgres`. Platform adaptation must not sacrifice that path.

## What this does not do

- No Milestone 9 POS/inventory
- No Supabase Auth, Data API clients, Storage, Realtime, or `@supabase/supabase-js`
- No observability vendor
- No migrations on Function startup
- No `pg_dump` from Vercel
