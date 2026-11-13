# ADR 0005 — Money representation

- Status: Accepted
- Date: 2026-08-24

## Context

The blueprint forbids float/double for money and requires integer minor units plus a currency code. Foundation tables in this milestone do not yet store money, but helpers and rules must exist before POS/sessions.

## Decision

- Persist money as `bigint` minor units (for example cents, or 1 SYP if the currency has no subunit).
- Persist `currency char(3)` on financial records when those tables are added; do not infer currency only from current organization settings when reading history.
- Application helpers accept `bigint` only — not `number`.
- Conversion from major units uses string/integer math and an explicit fraction-digit count (ISO 4217 exponent), never `parseFloat`.
- Completed charges/payments (future) are immutable; corrections are refunds/adjustments.

## Alternatives considered

| Option | Why not |
| --- | --- |
| `numeric` / decimal in JS `number` | IEEE floats still leak at the edges |
| Store major units as float | Forbidden by blueprint |
| Integer without currency on the row | Historical records break if org currency changes |

## Consequences

- No finance tables in Foundation Milestone 1 except the architectural rules and unit tests for helpers.
- JSON settings must not store money as floating JSON numbers for values that will be billed.

## Reversibility

Low once financial rows exist. Helpers can grow without changing the integer rule.

## Open questions

- Default fraction digits per currency for SYP vs USD — **NEEDS DECISION** (product)
- Tax handling — **NEEDS DECISION**
