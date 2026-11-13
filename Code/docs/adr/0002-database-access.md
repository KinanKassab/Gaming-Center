# ADR 0002 — Database access

- Status: Accepted
- Date: 2026-08-24

## Context

The blueprint requires PostgreSQL transactions, composite foreign keys, partial unique indexes, RLS, `FOR UPDATE`, and versioned migrations. It listed ORM choice as **Needs Decision**. Application code still needs a typed access layer.

## Decision

- **Source of truth for schema:** versioned SQL migrations in `drizzle/` (and equivalent folders).
- **Typed access:** Drizzle ORM mapped to those tables. Raw SQL is allowed for locks, RLS settings, and reports.
- **Driver:** `postgres` (postgres.js) against real PostgreSQL; `drizzle-orm/pglite` against PGlite in tests.
- **Tenant context:** `set_config('app.organization_id', …, true)` and
  `set_config('app.user_id', …, true)` (transaction-local) inside `withTenant()`.
- **Connections:** `DATABASE_URL` is the request runtime (`gaming_app`).
  `MIGRATION_DATABASE_URL` is migrations/admin only (ADR 0008).

## Alternatives considered

| Option | Why not |
| --- | --- |
| Prisma | Historically awkward for composite FKs, partial unique indexes, and RLS; hides SQL we must control |
| Kysely only | Excellent SQL builder; we would still write migrations by hand. Drizzle covers schema + queries well enough |
| Raw `pg` only | Too little type safety for a long-lived product |
| DB-per-tenant | Rejected by blueprint for MVP |

## Consequences

- Do not generate the entire Gaming/POS/Finance schema in one migration.
- RLS is enabled and forced on tenant tables. The request connection is
  `gaming_app` (no `BYPASSRLS`, not superuser). There is no `app.bypass_rls`
  skip in policies (ADR 0008).
- Historical financial rows (when added) are not updated in place.

## Reversibility

Medium-high. SQL migrations remain valid if Drizzle is replaced.

## Open questions

- Exact production pooling product (PgBouncer vs driver pool) — **NEEDS DECISION** when deploying
