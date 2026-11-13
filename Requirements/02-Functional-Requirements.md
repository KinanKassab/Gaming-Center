# 02 — Functional requirements

Source: Blueprint v1.1 §§7–14, §20, §24–25. Implementation of most items is **later than Foundation Milestone 1**.

## Core administration

| ID | Requirement | Status |
| --- | --- | --- |
| FUN-001 | Create and archive organizations (tenants) with slug, name, default currency, timezone, and locale. | MVP |
| FUN-002 | Create, update, and archive branches per organization with a unique code per organization. | MVP |
| FUN-003 | Invite or attach users to an organization via membership (INVITED / ACTIVE / SUSPENDED). A user identity may later belong to more than one organization. | MVP |
| FUN-004 | Assign one or more roles to a membership. Effective permissions are the union of those roles. | MVP |
| FUN-005 | Grant branch access independently of roles (view / operate / manage or the chosen access_mode model). | MVP |
| FUN-006 | Maintain organization-level customers: display name, optional phone/email, status, notes, optional created branch. Do **not** default unique phone until a commercial rule is decided. | MVP |
| FUN-007 | Convert a guest session to a registered customer without copying the session or recreating the charge (when sessions exist). | MVP |
| FUN-008 | Resolve settings by Entity → Branch → Organization → definition default. | MVP |
| FUN-009 | Enable or disable feature flags per organization; flags control presence, settings control behavior. | MVP |

## Gaming (not Foundation Milestone 1)

| ID | Requirement | Status |
| --- | --- | --- |
| FUN-010 | Maintain branch areas, organization device types, and branch devices. Do not hard-code PC/PS5. Occupied vs free is derived from active/paused sessions, not `operational_status`. | MVP |
| FUN-011 | Maintain pricing plans and assignments with deterministic precedence (device over area/type over branch over organization, plus documented priority). | MVP |
| FUN-012 | Start, pause, resume, move, complete, and cancel gaming sessions as specified in `05-Gaming-Session-and-Pricing-Rules.md`. | MVP |
| FUN-013 | Link POS orders to a session without embedding POS inside the gaming schema. | MVP |
| FUN-014 | Record device maintenance and keep it consistent with device operational status. | MVP |
| FUN-015 | Reservations, tournaments, advanced time-of-day pricing, remote device control. | Phase 2 / Future |

## POS, inventory, finance

See `06-POS-Inventory-Finance-Requirements.md`.

## Cross-cutting operations

| ID | Requirement | Status |
| --- | --- | --- |
| FUN-016 | Append-only audit of sensitive actions (who, when, what changed, optional branch, optional reason). | MVP |
| FUN-017 | Write domain events to an outbox in the same database transaction as the state change so other terminals can be notified later. No Kafka or distributed bus. | MVP |
| FUN-018 | Support idempotency keys for retryable mutations (especially payments). | MVP |
| FUN-019 | File bytes are not stored in PostgreSQL; only metadata is. Object storage provider is **NEEDS DECISION**. | MVP (metadata) / NEEDS DECISION (storage) |
| FUN-020 | Realtime transport (WebSocket vs SSE) for floor updates. | NEEDS DECISION (outbox is required now) |
| FUN-021 | Reporting uses source facts (sessions, charges, payments, movements), not editable KPI counters. | MVP |
