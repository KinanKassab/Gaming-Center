# Backup and restore

Pilot cannot defer backups. Supabase is the managed PostgreSQL host for this adaptation; do not assume a cloud snapshot product exists until the **plan** is verified at deployment time. Runtime `DATABASE_URL` and the transaction pooler are **not** backup credentials.

## What to back up

The entire PostgreSQL database that holds this application (schema `public`, including `schema_migrations`). That includes:

- organizations, branches, users, memberships, roles, grants
- customers, settings, gaming master data
- sessions, segments, pauses
- finalized billing columns and `billing_breakdown`
- finance charges, charge items, payments, allocations
- audit logs, outbox, idempotency keys
- Better Auth `auth_*` tables (credentials/sessions)

Application servers are stateless. Object storage is not in use.

## Frequency and retention (pilot recommendation)

These are **recommendations**, not guarantees. Business approval of RPO/RTO is NEEDS DECISION.

| | Pilot recommendation |
| --- | --- |
| Frequency | At least daily full dump; before every migration |
| Retention | 14 days of daily dumps; keep the pre-pilot and pre-migration dumps longer |
| Encryption | Encrypt dumps at rest (disk encryption and/or dump file encryption). Restrict who can read dump files. |
| Verification | Restore drill at least once before opening the pilot, then weekly during pilot |

## RPO / RTO (proposed, not guaranteed)

| | Meaning | Pilot proposal |
| --- | --- | --- |
| **RPO** | Acceptable data-loss window | 24 hours (daily dump). Tighter RPO needs WAL archiving / PITR on the future host. |
| **RTO** | Acceptable recovery time | 4 hours for a single-site pilot (restore dump, re-point `DATABASE_URL`, smoke test). |

Do not claim these numbers until the chosen host and backup tooling actually support them.

## Restore ownership

The **pilot operator** (human) owns restore decisions. Engineers execute restore only on disposable or explicitly designated targets. Never restore over an unidentified database. Never use `gaming_center_security_test` as a production restore target.

## Tooling

`pg_dump --format=custom` and `pg_restore` (PostgreSQL client tools matching the server major version).

**Backup role requirement:** tenant tables use `FORCE ROW LEVEL SECURITY`. A table owner (typical `MIGRATION_DATABASE_URL` user) and `gaming_app` **cannot** `COPY`/`pg_dump` that data. Production dumps and restores must use a dedicated role with `BYPASSRLS` (or a superuser used only for backup). Do not disable FORCE RLS in production to make dumps work. Do not dump with `DATABASE_URL`. Do not dump through the Supavisor transaction pooler (port 6543). Prefer the direct `db.<project-ref>.supabase.co` endpoint. On Supabase Free/Staging, keep an external encrypted dump before real-money use.

```bash
pg_dump --format=custom --no-owner --file=pilot.dump "$BACKUP_DATABASE_URL"
# restore onto an empty disposable database only, with the same BYPASSRLS role
pg_restore --no-owner --dbname="$DISPOSABLE_RESTORE_URL" pilot.dump
```

Then verify representative rows: organization, branch, customer, session, `gaming_total_minor`, `billing_breakdown`, `finance_charges`, `finance_payments`, `finance_payment_allocations`.

## Supabase-hosted notes

Runtime `DATABASE_URL` (transaction pooler, `gaming_app`) is **not** a backup credential. Do not dump through port 6543. Use a direct PostgreSQL endpoint (or session pooler only if the backup tool requires IPv4 and direct IPv6 is unavailable) with a dedicated BYPASSRLS role that is never stored on Vercel.

On Supabase Free/Staging, do not claim provider backups exist until the plan is verified. External encrypted dumps remain required before real-money use. See `VERCEL_SUPABASE_DEPLOYMENT.md`.

## Verification in this repository

The live suite (`npm run test:postgres`) performs a dump/restore drill on disposable `gaming_center_security_test` only, with `GAMING_TEST_ALLOW_RESET=true`. The disposable migrator has no `BYPASSRLS`, so that drill suspends FORCE RLS only around table-owner COPY — that workaround is **not** a production procedure. It is not a production backup.
