# ADR 0009 — Vercel + Supabase PostgreSQL (managed database only)

- Status: Accepted for platform adaptation (in development until hosted + Vercel verification)
- Date: 2026-08-27

## Context

Milestones 1–8 are closed on a modular Next.js monolith with Better Auth, Drizzle, postgres.js, PostgreSQL, RLS/`gaming_app`, and transaction-local tenant GUC. ADR 0001 left production host and managed PostgreSQL vendor as **NEEDS DECISION**. ADR 0002 left pooling product as **NEEDS DECISION**.

This adaptation deploys the **existing** M1–M8 system. It is not a product milestone and does not start Milestone 9.

ADR 0001 rejected “Supabase-as-app” (Auth + Data API as the application platform). That rejection stands. Supabase is used here as **hosted PostgreSQL**.

## Decision

- **App host:** Vercel, Next.js 15 **Node.js Functions** (not Edge for database work). Application root remains `Code/`.
- **Database host:** Supabase PostgreSQL with FORCE RLS and the existing migrations.
- **Runtime connection:** Supavisor **transaction** pooler (`*.pooler.supabase.com:6543`) as URL user `gaming_app.<project-ref>`. Authoritative check remains `current_user = gaming_app` with pinned role attributes.
- **Migration connection:** Direct `db.<project-ref>.supabase.co:5432`, or Supavisor **session** pooler `:5432` when IPv4 requires it. Transaction pooler is rejected for migrate/`pg_dump`.
- **Driver:** Keep postgres.js. Runtime always `prepare: false` (transaction mode has no prepared statements; local PostgreSQL still works).
- **Client pool:** Small bounded `max` (default 2, cap 4). Supavisor is the server-side pool.
- **Auth:** Better Auth only. No Supabase Auth, no duplicate identities. Public HTTP email sign-up is fail-closed after the first owner (`GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN` + `core_platform_bootstrap`). Staff accounts use in-process `auth.api.signUpEmail`.
- **Data API:** Unused. Disable in Dashboard when available; migration `0011` revokes `anon` / `authenticated` / `service_role` on public application objects when those roles exist.
- **Tenant GUC:** Unchanged — `set_config(..., true)` inside `withTenant` transactions. No session-sticky security state.
- **Region:** Vercel Functions `dub1` colocated with Supabase Ireland / `eu-west-1`. Not Frankfurt/`fra1`.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Supabase Auth + RLS-from-JWT | Duplicates identity; contradicts ADR 0003/0007 |
| Prisma / Edge ORM | Rejected in ADR 0002; transaction/RLS/`FOR UPDATE` stay on postgres.js |
| Session pooler for Vercel runtime | Holds backends too long for serverless; transaction mode is the documented serverless path |
| Large postgres.js `max` | Multiplies connections across Function instances against a shared pooler |
| Running migrate/`pg_dump` in Functions | Wrong privilege, ephemeral FS, transaction-pooler incompatibilities |

## Consequences

- Local PostgreSQL 18 + `test:postgres` remains the disposable security harness.
- Hosted proof is a separate `npm run test:supabase` fail-closed suite.
- Commercial Vercel plan (Hobby vs Pro) is still not a product decision. Hobby is not approved for real-money production.
- Backup still requires a dedicated BYPASSRLS role and an out-of-band path (`BACKUP_RESTORE.md`).

## Reversibility

Medium. SQL and domain modules are host-agnostic. Connection classification is small. Switching managed Postgres vendors would replace URL rules and docs, not the schema.

## Open questions

- Commercial production Vercel plan — **NEEDS DECISION**
- Dedicated BYPASSRLS backup role provisioning on the chosen Supabase plan — still required for real-money GO
