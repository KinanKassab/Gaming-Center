# ADR 0001 — Technical stack

- Status: Accepted
- Date: 2026-08-24

## Context

Foundation Milestone 1 needs a stack that is modern, TypeScript-friendly, PostgreSQL-native, transaction-capable, testable without paid services, and suitable for a modular monolith. The blueprint left backend/frontend framework as **Needs Decision**.

## Decision

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| UI | React 19 via Next.js App Router |
| App shape | Modular monolith inside `Code/` |
| Database | PostgreSQL 16+ (production/dev). PGlite (in-process Postgres) for automated tests and optional local work without installing a server |
| DB access | Drizzle ORM + SQL migrations (see ADR 0002) |
| Validation | Zod at trust boundaries |
| Tests | Vitest |
| Auth (later) | Self-hosted Better Auth — see ADR 0003; not wired in this milestone |

## Alternatives considered

| Option | Why not now |
| --- | --- |
| Vite SPA + Fastify/Express | Extra deployable and CORS surface; Next.js gives one TypeScript app with server-side enforcement |
| NestJS | Heavier DI for a small team; not required for a modular monolith |
| Prisma as primary data layer | Weaker fit for composite FKs, partial unique indexes, and RLS (ADR 0002) |
| Paid BaaS (Firebase, Supabase-as-app) | Vendor lock-in; blueprint wants PostgreSQL we control |
| Microservices, Kafka, Redis, GraphQL, Kubernetes | Explicitly out of foundation scope |

## Consequences

- Domain logic lives under `src/core` and `src/modules`, not in React components.
- Next.js `src/app` is a delivery shell (pages/route handlers), not the place to own schema or money math.
- Docker is optional, never required.

## Reversibility

Medium. Next.js routing is framework-specific; the SQL schema and domain modules can move behind another HTTP layer later.

## Open questions

- Production host (VPS vs managed Node) — **NEEDS DECISION**
- Managed PostgreSQL vendor — **NEEDS DECISION**
