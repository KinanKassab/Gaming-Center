# Pilot runbook

Operational notes for a **controlled** Akodus Gaming Center pilot. This is not a full production SRE manual and does not choose a hosting vendor.

Milestone 8 is **CLOSED**. Real-money pilot is **CONDITIONAL GO** (not GO). Do not take real customer money until the ten pre-pilot conditions in `PILOT_CHECKLIST.md` are met.

## What the pilot is

The live path is:

Customer (optional) → Device → Session → Billing → Checkout → Payment (CASH or staff-recorded ShamCash)

Do **not** take real money on PACKAGE plans that will be moved between devices. See PACKAGE restriction below.

## Bootstrap a new pilot organization (application only)

Use the admin UI. Do not insert tenant rows with ad-hoc SQL.

1. Sign up / sign in (`/login`). Email + password is the interim auth method (MFA is NEEDS DECISION).
2. Create the organization (`/admin`). The creator becomes OWNER.
3. Create branches (`/admin/branches`) and grant branch access to staff (`/admin/users`).
4. Confirm settings: `gaming.allow_guest_sessions`, `gaming.billing_unit_seconds`.
5. Create areas, device types, devices, TIME_BASED pricing plans, and assignments (`/admin/gaming/*`).
6. Confirm CASH and SHAMCASH methods exist (seeded per organization). ShamCash is **staff-recorded**, not provider-verified.
7. Create at least one extra staff user with **only** the permissions they need. Do not share the owner password.
8. Run a dry guest session and a dry customer session **without real money**.

Do not seed fake production customers or historical sessions.

## Recommended permission sets (documentation only — not seeded templates)

Manager/Cashier templates remain NEEDS DECISION. For a one-site pilot, assign permissions explicitly:

| Duty | Permissions | Branch |
| --- | --- | --- |
| Floor operator | `gaming.sessions.read`, `.start`, `.operate` | OPERATE |
| Cashier | operator + `finance.payments.read`, `finance.payments.create` | OPERATE |
| Owner | seeded OWNER (all current codes) | MANAGE on every branch |
| Reports | `gaming.sessions.read` + `finance.payments.read` | VIEW |

Do not grant `gaming.sessions.cancel` or `core.roles.manage` to cashiers.

## PACKAGE restriction (pilot)

PACKAGE billing is defined **per closed segment**. Multi-segment PACKAGE (typically after MOVE) is **not defined** by the blueprint and would previously charge N × package price.

M8 fails closed:

- `moveSession` rejects PACKAGE → anything and anything → PACKAGE
- Final billing rejects any session with more than one segment if any segment is PACKAGE

Pilot rule: use TIME_BASED for devices that may move. Single-device PACKAGE (no MOVE) remains billable.

## Payment methods

- **CASH** — local staff-recorded. No cash drawer or shift count.
- **SHAMCASH** — staff records that the customer paid in ShamCash. **Not** an API verification. Automated ShamCash remains NEEDS VERIFICATION / POTENTIAL INTEGRATION.

## Incidents

| Symptom | First checks | Do not |
| --- | --- | --- |
| App unavailable | Process up? `/api/health/live` | Restart by pointing `DATABASE_URL` at the migrator |
| Database unavailable | `/api/health/ready` returns `not_ready`; DB host/disk | Repair by dropping tenant tables |
| Login failure | User ACTIVE? Membership ACTIVE? Org ACTIVE? `APP_BASE_URL` matches the browser origin | Disable CSRF |
| Session will not start | Device ENABLED and free? Pricing assignment? Guest setting? | Start a second session on the same device |
| Session stuck ACTIVE | Pause/resume/end from session detail; check occupancy unique index errors | UPDATE `gaming_sessions` by hand |
| Billing will not finalize | PACKAGE + MOVE? Snapshot malformed? Overage? | Recalculate `gaming_total_minor` |
| Payment will not record | Finalized? Remaining? Idempotency-Key? Guest must pay remaining in full | Insert `finance_payments` by hand |
| Wrong payment recorded | Refunds/voids are **not implemented** | UPDATE/DELETE payment rows |
| Need backup restore | Follow `BACKUP_RESTORE.md`; restore ownership is the operator | Restore onto a live DB without a checkpoint |

Manual financial correction remains unsupported. Use an approved process after M8; do not edit completed charges or payments in SQL.

## Logging

JSON lines on stdout/stderr. Fields: `ts`, `level`, `event`, `requestId`, optional `organizationId` / `actorId`. Passwords, secrets, session tokens, and database URLs are redacted. Correlation id is `x-request-id`.

## Data retention

No automated deletion of audit, session, payment, or charge history. Retention policy is NEEDS DECISION. For pilot, keep everything.
