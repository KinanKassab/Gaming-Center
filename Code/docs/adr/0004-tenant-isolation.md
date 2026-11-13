# ADR 0004 — Tenant isolation

- Status: Accepted
- Date: 2026-08-24

## Context

Highest risk in a shared database is cross-tenant leakage. The blueprint mandates `organization_id`, composite FKs, backend authorization, RLS, and automated isolation tests.

## Decision

1. **Application:** Every privileged operation authenticates, then uses the session’s organization (and authorized branches). Client-supplied org/branch IDs may only confirm the session; they never select the tenant.
2. **Schema:** Tenant tables include `organization_id NOT NULL`. Branch tables also include `branch_id`. Child tables reference parents with composite FKs `(id, organization_id)` so a branch from Org B cannot attach to Org A.
3. **RLS:** `ENABLE` + `FORCE ROW LEVEL SECURITY` on tenant tables. Policies compare `organization_id` (or `id` on `core_organizations`) to `app.organization_id`, with a narrow self-read/self-activate path via `app.user_id`. Policies must not offer a GUC the runtime role can flip to skip tenant checks (ADR 0008).
4. **Request DB role:** `DATABASE_URL` connects as `gaming_app` — not table owner, not superuser, not `BYPASSRLS`. Migrations use `MIGRATION_DATABASE_URL` only.
5. **No bypass setting:** `app.bypass_rls` was removed in migration `0003`. Do not re-add a request-path skip.

## Alternatives considered

| Option | Why not |
| --- | --- |
| UI filters only | Insufficient |
| DB-per-tenant | Blueprint rejected for MVP |
| RLS without app checks | RLS is defense-in-depth, not the only control |
| Trusting Next.js cookies for org id without membership lookup | Unsafe |

## Consequences

- Tests create two organizations and prove Org A cannot read Org B, including by primary key.
- `core_users` is a global identity table (no `organization_id`). Isolation is via memberships. Listing users is always through membership queries.

## Reversibility

Low for the `organization_id` + composite FK pattern (by design). RLS policy SQL can be refined.

## Open questions

- Platform-admin role that can list all organizations — **NEEDS DECISION** (not needed for MVP cashier flows)
