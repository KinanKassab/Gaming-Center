# ADR 0006 — Configuration strategy

- Status: Accepted
- Date: 2026-08-24

## Context

The blueprint requires configuration-driven business behavior (areas, prices, payment methods, flags) without per-customer `if (organizationId === …)` forks. Integrity rules stay in code and constraints.

## Decision

- **Definitions** (`core_settings_definitions`, `core_features`, `core_permissions`) are seeded by migrations/code.
- **Values** (`core_setting_values`, `core_organization_features`, roles/permissions assignments) are per tenant and editable by authorized users.
- Resolution order for settings: Entity → Branch → Organization → definition default (when those scopes exist).
- Feature flags turn capabilities on/off; settings tune behavior.
- Invariants (tenant isolation, one active session per device, money integrity) are **not** configurable flags that can be switched off.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Hard-coded PC/PS5/prices | Blueprint forbids |
| One jsonb blob per org | Cannot constrain or index cleanly |
| Per-tenant code forks | Unmaintainable |

## Consequences

- Foundation ships definition + value tables and a resolver helper; Gaming/POS master data comes in later milestones.
- Sensitive settings (`is_sensitive`) must not be returned wholesale to the browser.

## Reversibility

High for individual keys. Low for the definition/value split (intentionally stable).

## Open questions

- Exact MVP setting key list (billing unit, pause billable, etc.) — product defaults **NEEDS DECISION**
