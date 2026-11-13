# Deployment runbook (vendor-neutral)

Chosen platform for this adaptation: **Vercel + Supabase PostgreSQL** (ADR 0009).
Exact Vercel/Supabase settings, env matrix, pooler modes, and hosted tests:
`VERCEL_SUPABASE_DEPLOYMENT.md`. This file stays the operator rollback/health
checklist.

## Runtime requirements

| Need | Expectation |
| --- | --- |
| Node.js | 20+ (22 recommended), `next start` |
| PostgreSQL | 16+ (18 verified in development). Persistent managed instance. Not ephemeral disk. |
| HTTPS | Required on the public hostname. Terminate TLS at the platform or reverse proxy. |
| Secrets | `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_BASE_URL` in a secret store. Never in git. |
| Logs | Capture process stdout/stderr. No required third-party vendor (NEEDS DECISION). |
| DNS | One public hostname that matches `APP_BASE_URL` |

## Roles

- **`DATABASE_URL`** — LOGIN `gaming_app` (`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN`). Request path only.
- **`MIGRATION_DATABASE_URL`** — privileged role that can run SQL migrations and `ALTER ROLE gaming_app`. Never used by HTTP.

The application refuses to start in production if `DATABASE_URL` is missing, uses a non-`gaming_app` catalog role, or equals `MIGRATION_DATABASE_URL`. On Vercel, `DATABASE_URL` must be the transaction pooler (`gaming_app.<project-ref>`). `BETTER_AUTH_SECRET` must be ≥ 32 characters. `APP_BASE_URL` is required on Vercel Production (https). Preview uses Vercel-provided `*.vercel.app` hosts plus `GAMING_PREVIEW_DB_OK`.

## Deploy order

1. Backup / checkpoint the database (`BACKUP_RESTORE.md`).
2. Verify migration credentials (not the runtime URL).
3. Run `npm run db:migrate` against `MIGRATION_DATABASE_URL`.
4. Confirm migrate output and `gaming_app` pin.
5. Deploy the app artifact (`npm run build` then `next start` or platform equivalent).
6. Hit `/api/health/live` then `/api/health/ready`.
7. Smoke: sign-in, select org, open floor, record a **zero-value dry** path if possible.
8. Watch logs for `api.unhandled` and `health.ready.failed`.
9. If broken, follow rollback below.

## Rollback

| Failure | Rollback |
| --- | --- |
| App deploy (bad build, crash loop) | Redeploy the previous app artifact. Database is unchanged. |
| Bad configuration / auth | Fix env (`APP_BASE_URL`, `BETTER_AUTH_SECRET`, cookie Secure/HTTPS). Redeploy/restart. No schema rollback. |
| Database unavailable | Restore from backup onto a **new** instance or failover. Do not rewrite financial rows. |
| Failed migration | **Do not** assume down-migrations exist. Keep the previous app version if it is compatible with the new schema; otherwise restore the pre-migration backup. Prefer a **forward-fix** migration over DROP. |
| Schema already applied, app incompatible | Roll the **app** forward or back only if the schema is backward-compatible. Otherwise restore backup. |

Completed financial history must not be truncated as a rollback technique.

## Health

- `GET /api/health/live` — process responds `{ "status": "ok" }`
- `GET /api/health/ready` — `{ "status": "ok" }` or `503 { "status": "not_ready" }`

Public bodies stay generic. Do not expose PostgreSQL version or credentials.

## Headers and CSRF

The app sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, a conservative CSP, and `Permissions-Policy`. HSTS belongs on the HTTPS terminator, not in this app (local HTTP `next start` must keep working).

Cookie-authenticated mutations require `Origin` in the trusted origin set. Vercel Production: `APP_BASE_URL` only. Vercel Preview: `APP_BASE_URL` (if set) plus Vercel-provided `*.vercel.app` hosts. SameSite=Lax + HttpOnly. Cross-origin admin clients are not supported.
