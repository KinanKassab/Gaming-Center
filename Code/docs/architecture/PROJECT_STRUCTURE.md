# Project structure

The application root is `Code/`. The Next.js App Router lives in `src/app` because that is how Next.js loads routes. Domain code does **not** live in components.

```
Code/
  drizzle/                     # SQL migrations (source of truth)
    0001_core_foundation.sql   # Tenancy, identity tables, RLS, registries
    0002_identity_auth.sql     # Better Auth tables, app.user_id RLS, read perms
    0003_security_hardening.sql # Remove RLS GUC bypass, uniqueness, membership invariants
    0004_runtime_role_enforcement.sql # Fail closed if gaming_app cannot be pinned
    0005_configuration_customers.sql # Settings read perm, customer/setting invariants
    0006_gaming_master_data.sql      # Areas, device types, devices, pricing plans/assignments
    0007_gaming_sessions.sql         # Sessions, segments, pauses, occupancy index
    0008_gaming_billing.sql          # Billing fill fields + closed-row one-time amount write
    0009_finance_checkout.sql        # Payment methods, charges, payments, allocations, DELETE hardening
    0010_pilot_hardening.sql         # Runtime DELETE least-privilege for audit/masters; no CREATE on public
    0011_supabase_platform_hardening.sql # Portable revoke of anon/authenticated/service_role on public objects
    0012_platform_bootstrap.sql          # Singleton first-owner / first-organization claim (no RLS)
    0013_prorated_hour_billing.sql       # Additive time_billing_mode UNIT | PRORATED_HOUR (do not rewrite 0001–0012)
  src/
    app/                       # HTTP/UI shell only
      api/                     # Route handlers (parse → context → use-case)
        _lib/handler.ts        # Error mapping, org cookie, context helpers
        auth/[...all]/         # Better Auth endpoints
        organizations|branches|memberships|roles|permissions|audit|me|
        settings|features|customers|gaming|finance/
      admin/                   # Admin UI (UX consolidation pass)
        _components/           # Shell, forms, actions
        _lib/context.ts        # Page-side context resolution
        gaming/                # Floor, sessions, areas, device types, devices, pricing
        onboarding/            # Gaming Center Setup Wizard (not /setup bootstrap)
      _components/             # Shared UI primitives (duration, money, FieldHelp, dialogs)
      _lib/display.ts          # Human-facing labels
      login/                   # Sign-in page
      setup/                   # One-time first-owner bootstrap UI
    core/                      # Cross-cutting: ids, money, codes, duration, errors, tenancy, config
    db/                        # client (schema map, runtime singleton), migrate,
                               # connection-mode (Supavisor vs local), runtime-role
                               # pin/assert, disposable-test-db + supabase-test guards,
                               # tenant transaction helper, schema.ts, auth-schema.ts
    modules/
      identity/                # Core users, memberships, roles, permissions,
                               # branch access, audit — all admin use-cases
      settings/                # Setting values, feature flags, typed validation
      customers/               # Organization-level customer master data
      gaming/                  # Master data, session engine, floor, billing calculator, bulk devices
      finance/                 # Checkout, payment recording, session-linked POS settlement
      catalog/                 # Products + prices (NON_STOCK drinks slice)
      pos/                     # Session-linked orders → charges → links
      reports/                 # Pilot operational reports (finalized bills + recorded payments)
      onboarding/              # Setup status derived from actual tenant rows
      inventory/               # Reserved
    auth/                      # Better Auth boundary: instance factory,
                               # provisioning port, authorization pipeline
    shared/                    # Tiny generics (Result) — not a dumping ground
    ops/                       # pg_dump/pg_restore helpers for restore drills
    middleware.ts              # Request id + baseline security headers
    instrumentation.ts         # Production env fail-closed (skipped during next build)
  tests/
    isolation/                 # Tenant isolation (RLS + composite FK)
    identity/                  # Authentication, memberships, roles, branch
                               # access, audit — full-pipeline integration tests
    settings/                  # Settings resolution, branch overrides, features
    customers/                 # Customer CRUD, duplicates, isolation, audit
    gaming/                    # Areas, devices, pricing, sessions, floor, billing
    finance/                   # Checkout, payments, settlement, FIFO
    pos/                       # Session-linked drink orders + multi-charge pay
    security/                  # RLS bypass, runtime role, uniqueness, membership
                               # self-update, provisioning fail-closed, disposable
                               # DB reset guard (PGlite/unit). postgres-live.test.ts
                               # is excluded from npm test — run npm run test:postgres.
                               # supabase-hosted.test.ts is excluded — run npm run test:supabase
    http/                      # Real App Router route + middleware behavior
                               # (identity, settings/customers, gaming master, sessions, billing, checkout, health, CSRF)
    db/                        # Migrations, constraints
    core/                      # Unit tests
    reports/                   # Pilot operational reports
    helpers/                   # PGlite + identity test environment
  docs/                        # Architecture, ADRs, development guide, operations runbooks
                               # (includes VERCEL_SUPABASE_DEPLOYMENT.md)
  vercel.json                  # Function region dub1 (Root Directory = Code)
```

## Module boundaries

- A module owns its tables. Other modules call functions/services or react to outbox events.
- React components must not import `drizzle` or issue SQL; pages call module use-cases.
- Better Auth is imported **only** inside `src/auth`. Domain code sees `auth_subject` strings and resolved contexts.
- Do not add a `utils/` catch-all. If code is shared, put it in `core/` with a domain name.

## What Milestones 1–2 contain

Core tenancy schema, RLS, tenant transaction helper, money helpers, Better Auth
integration, Core User mapping, organization memberships, roles/permissions,
branch access, authorization pipeline, admin APIs + minimal admin UI, audit
trail, isolation and identity test suites.

## What Milestone 3 contains

Typed settings admin (org values + branch overrides with `assertBranchAccess`),
organization feature flags, organization-level customer CRUD/search/archive,
permission-gated admin nav for new and existing links, and tests for
authorization, tenant isolation, validation, and audit.

## What Milestone 4 contains

Branch-owned gaming areas and devices, organization-owned device types and
pricing plans, pricing assignments, `gaming.master.read` / `.manage`, admin
APIs and pages, audit, tenant/branch isolation. No session engine, floor UI,
timers, or billing calculation.

## What Milestone 5 contains

CLOSED. Gaming Floor, session lifecycle (start/pause/resume/move/end/cancel),
session segments and pauses, occupancy derived from ACTIVE/PAUSED sessions,
guest and customer association, immutable pricing snapshots on segments,
branch-scoped APIs and UI, audit + outbox facts. No POS or payments.

## What Milestone 6 contains (CLOSED)

Gaming billing engine: integer-safe TIME_BASED and PACKAGE calculation from
immutable segment snapshots, pause overlap using stored `is_billable`,
explainable breakdown, one-time finalization into `gaming_total_minor` /
`computed_amount_minor` / `billing_breakdown`. No POS, payments, or charges.

## What Milestone 7 contains (CLOSED)

Checkout and payment recording for finalized M6 gaming bills. Canonical amount due is
`gaming_total_minor`. CASH and manual ShamCash recording, partial payments for registered
customers, guest full settlement, idempotent retries, session-row locking plus allocation
cap. No POS catalog, inventory, cash shifts, refunds, or provider APIs.

## What Milestone 8 contains (CLOSED)

Production/pilot hardening: env validation, CSRF Origin fail-closed in production, cookie flags, security headers, health/readiness, structured logs, runtime DELETE least-privilege (`0010`), PACKAGE+MOVE fail-closed, operational reports, backup/restore docs and disposable restore drill. Not POS catalog or inventory. Pilot: **CONDITIONAL GO**.

## What Milestone 9 contains (session-linked NON_STOCK slice — IN DEVELOPMENT)

Authorized 2026-09-24. Migration `0018`, `modules/catalog` + `modules/pos`, multi-charge
checkout (gaming + linked POS), FIFO from allocations, guest combined remaining, Products
admin + session add-drink. Inventory balances/movements and walk-in counter POS are deferred.

## What the UX / Product Consolidation Pass contains (IN DEVELOPMENT)

Owner-friendly admin shell, auto-generated internal codes, bulk device creation, simplified pricing UI mapped to existing billing semantics, duration picker, FieldHelp, Gaming Center Setup Wizard (`/admin/onboarding`, separate from `/setup`), dashboard checklist, owner command-center dashboard. No schema migration. Not complete until browser verification. Not a substitute for M9 inventory.

## What platform adaptation contains (IN DEVELOPMENT)

Vercel Node.js Functions + Supabase PostgreSQL (managed DB only). Transaction-pooler runtime, `prepare: false`, bounded client pool, pooler username parsing, Preview origin/CSRF rules, migration `0011`, hosted `test:supabase` harness. Not complete until hosted Supabase and Vercel→Supabase are verified.

## What it does not contain

Inventory balances/movements, walk-in/counter POS, Cards/NFC, loyalty, memberships, WebSockets,
offline edge sync, cash shifts, refunds, fiscal receipts, accounting P&L.
