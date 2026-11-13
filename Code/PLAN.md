# Milestone 9 — Session-Linked POS — Execution Plan

**Status:** APPROVED and IMPLEMENTED (session-linked NON_STOCK slice). Inventory and walk-in POS remain deferred.  
**Author role:** Senior Staff / Fintech-ERP reconnaissance  
**Date:** 2026-09-24

---

## STEP 1 — Architecture & Finance Reconnaissance (findings)

### What already exists (reuse — do not reinvent)

| Area | Existing abstraction | Location |
| --- | --- | --- |
| Tenant TX + GUC | `withTenant` / `withPortalToken` | `src/db/tenant.ts` |
| Money | `bigint` minor units, `addMinor` / `subtractMinor` / `parseMinorUnits` | `src/core/money.ts` |
| Internal codes | `allocateInternalCode`, `insertWithAllocatedCode` | `src/core/codes.ts` (prefix pattern `B-` / etc.) |
| Permissions | `PERMISSIONS` + `core_permissions` seed + OWNER backfill | `src/modules/identity/types.ts`, migrations |
| Branch gate | `requireBranchAccess` / `assertBranchAccess` | `src/modules/gaming/access.ts`, `src/core/tenancy.ts` |
| Gaming pricing resolve (pattern only) | Device→…→Org winner + **immutable snapshot** | `src/modules/gaming/pricing-resolve.ts` — **do not reuse for POS prices**; mirror the *idea* (server resolve + snapshot) |
| Gaming billing finalize | M6 one-time fill; immutable after finalize | `src/modules/gaming/billing.ts` — **do not modify** |
| Session charge (M7) | `ensureSessionCharge` → `source_module=gaming`, `source_type=session`, item `GAMING_TIME` | `src/modules/finance/checkout.ts` |
| Payments | `finance_payments` + `finance_payment_allocations` (charge-scoped), idempotency `finance.payments` | `0009_finance_checkout.sql`, `checkout.ts` |
| Guest full-pay | Server: `guest && amount !== remaining` → conflict | `recordSessionPayment` |
| Outbox | `core_outbox_events` inserts in same TX | sessions + checkout |
| Audit | `recordAudit` | `src/modules/identity/audit.ts` |
| Charge source CHECK | Already allows `'gaming' \| 'pos' \| 'manual_adjustment'` | `0009` |
| HTTP shell | `handle` / `handleMutation` / `requireOrganization` | `src/app/api/_lib/handler.ts` |
| Checkout UI / payment form | Session checkout page + `CheckoutPaymentForm` | `admin/gaming/sessions/[sessionId]/checkout/*` |
| i18n | `t` / `useT`, `en.ts` / `ar.ts` | `src/i18n/*` |

### Finance model (authoritative)

```
finance_charges
  UNIQUE (organization_id, source_module, source_type, source_id)
  status OPEN | PARTIALLY_PAID | PAID (derived on payment TX)
finance_charge_items   — immutable after insert; name/price snapshots
finance_payments       — COMPLETED only; amount_minor > 0
finance_payment_allocations — amount to a charge (NOT to a line item)
```

**There is no item-level allocation table.** FIFO paid/remaining on lines must be **derived** from `sum(allocations)` on the charge vs ordered charge items.

### Current session checkout behavior (M7)

- Eligible only when session is **COMPLETED** + billing finalized.
- Checkout view totals = **gaming charge only** (`gaming_total_minor`).
- `recordSessionPayment` always allocates to **one** gaming charge via `ensureSessionCharge`.
- Guest must pay **full remaining of that gaming charge**.
- Does **not** recalculate pricing (correct; keep).

### Gaming billing (hard constraint)

- Source of truth: finalized `gaming_sessions.gaming_total_minor` + currency + `billing_finalized_at`.
- Charge copy: `ensureSessionCharge` — create-once; amounts immutable via DB triggers.
- **M9 must not** change calculator, finalize path, charge amount, or create a second gaming charge.

### Critical pre-existing POS-adjacent path (conflict awareness)

`postDrink` in `src/modules/finance/customer-ledger.ts` already inserts:

- `finance_charges` with `source_module='pos'`, `source_type='drink'`, `source_id=chargeId` (self-id)
- charge item `item_type='DRINK'`
- ledger entry kind `DRINK`

This is **ad-hoc customer-account drink debt**, not session-linked catalog POS. It is **not** fake UI for checkout, but it **occupies the `pos` source_module** namespace.

**Proposed coexistence (minimal, explicit — not a silent rewrite):**

| Path | `source_type` | Linked to session? | Keep? |
| --- | --- | --- | --- |
| Ledger ad-hoc drink | `drink` | No | Keep for customer statement UI until separately retired |
| M9 session POS | `order` | Yes via `gaming_session_order_links` | New |

Session checkout will **only** include POS charges whose orders are linked to the session (not every `source_module=pos` charge for the customer).

### Gaps M9 must fill

1. No catalog / product / price tables.
2. No `pos_orders` / `pos_order_items` / `gaming_session_order_links`.
3. Payment API accepts only `{ amountMinor, paymentMethodCode, … }` — **single allocation**.
4. `SessionCheckoutView` has no play/drinks line breakdown or multi-charge totals.
5. `getPayment` / `serializePayment` treat `charge.sourceId` as `sessionId` — **wrong for POS orders**; must resolve session via link table or gaming source only.
6. No FIFO helper for charge items.
7. No `pos.*` permissions (only `finance.payments.*`).
8. Inventory intentionally absent (correct for this slice).

### Tenancy / RLS patterns to copy

- Tables: `organization_id` (+ `branch_id` for branch-owned).
- Composite FKs for cross-tenant safety.
- `FORCE ROW LEVEL SECURITY` + `*_tenant` policies using `app.organization_id` GUC.
- Runtime role `gaming_app`: SELECT/INSERT (UPDATE where status advances); **no DELETE** on money tables.
- Application still authorizes with permissions + branch access; RLS is defense-in-depth.

### Tests that encode current money invariants

- `tests/finance/checkout.test.ts` — full/partial pay, guest full-pay, idempotency, bill immutability.
- `tests/http/finance-checkout.test.ts` — HTTP auth/idempotency.
- Any M9 change to payment schema must keep these passing (additive fields / multi-allocation with backward-compatible single-amount path).

---

## Locked product / architecture decisions (for approval)

1. **POS-013:** Separate charges. Gaming charge remains `gaming`/`session`. Each completed POS order → one charge `pos`/`order`/`order_id` with `POS_ITEM` line snapshots. **Not** one combined charge.
2. **FIFO:** Derived only. No `paid_minor` columns on order/charge items.
3. **Inventory:** `track_inventory=false`, `product_type=NON_STOCK` for drinks in this slice. No stock tables/movements.
4. **When drinks sell:** Allowed on **ACTIVE/PAUSED** sessions (and readable on checkout after COMPLETED). Atomic: order item → complete order → POS charge → session link → outbox in **one** `withTenant` transaction.
5. **Guest:** Combined remaining across **session gaming charge + linked POS charges**; partial pay rejected server-side.
6. **Payment API:** Extend to multi-allocation; keep existing single-`amountMinor` path as “allocate entire amount to gaming charge remaining” for backward compatibility **or** implement multi-allocation only and update all callers/tests in the same change set (prefer one clear path + update tests — see Phase 6).
7. **Permissions (new, following existing seed pattern):**
   - `pos.catalog.read` (LOW), `pos.catalog.manage` (MEDIUM)
   - `pos.orders.read` (LOW), `pos.orders.create` (HIGH)
   - Payments remain `finance.payments.create` / read stays `gaming.sessions.read` for checkout GET (existing).
8. **Do not modify** `modules/gaming/billing*.ts` or M6 finalize semantics.

---

## STEP 2+ — Execution plan (ordered; implement only after approval)

### STEP 3 — Database

- New migration **`drizzle/0018_pos_catalog_orders.sql`** (after `0017`).
- Tables (blueprint-aligned, MVP columns only):
  - `catalog_categories`
  - `catalog_products` (code via CHECK + unique; `track_inventory`; status ACTIVE/ARCHIVED; product_type includes NON_STOCK)
  - `catalog_product_prices` (org default `branch_id NULL` + branch override; `amount_minor`; `valid_from`/`valid_to`; `is_active`)
  - `pos_orders` / `pos_order_items` (snapshots: name, unit_amount_minor, total_minor, product_id nullable)
  - `gaming_session_order_links`
- Permissions insert + OWNER role backfill.
- RLS policies + grants mirroring finance/gaming masters.
- Mirror in `src/db/schema.ts`.
- **No** inventory movement tables.

### STEP 4 — Catalog domain (`modules/catalog`)

- Create category (optional), create product with `insertWithAllocatedCode({ prefix: "P-" })`.
- Set org price; optional branch override.
- **Server price resolve:** active branch price at `now` else org price else reject.
- List ACTIVE products with resolved price for a branch (for add-drink UI).
- Audit on create/price change; never mutate historical order snapshots.

### STEP 5 — POS domain (`modules/pos`)

Atomic use-case (single `withTenant` TX):

1. Lock session (`FOR UPDATE`); require same branch; status ACTIVE or PAUSED (or COMPLETED if we allow late add — **default: ACTIVE/PAUSED only**).
2. Resolve product + price.
3. Create or append OPEN order linked to session (or one order per sale — **default: one COMPLETED order per add-drink action** for clear 1:1 charge mapping and simpler FIFO per charge).
4. Insert order item with **price snapshot**.
5. Complete order → insert `finance_charges` (`pos`/`order`) + `finance_charge_items` (`POS_ITEM`) → set `pos_orders.charge_id` → `gaming_session_order_links` → outbox `pos.order.completed` + audit.
6. If charge insert fails, whole TX rolls back (no completed order without charge).
7. Append customer ledger `DRINK` debit **only if** `session.customerId` present, sourced from the real charge/order (reuse `appendCustomerLedgerEntry`; do not call ad-hoc `postDrink`).

**Quantity updates:** before completion only; after completion immutable (new order for more drinks).

### STEP 6 — Finance integration (`modules/finance/checkout.ts`)

**Do not recreate gaming charge logic.** Extend around it:

- Pure helper: `deriveFifoItemSettlements(items, appliedMinor)` → per-item paid/remaining.
- Load gaming charge via existing `loadChargeForSession`.
- Load POS charges via session → links → orders → charges.
- Extend `SessionCheckoutView` **additively**:
  - `playingStartedAt` / `playingEndedAt` (or formatted by UI)
  - `play: { chargeId, totalMinor, appliedMinor, remainingMinor, … }`
  - `drinks: [{ orderItemId, chargeId, chargeItemId, description, totalMinor, paidMinor, remainingMinor, status }]`
  - Combined `billTotalMinor` / `appliedMinor` / `remainingMinor` / settlement across all session charges
  - Keep existing fields where tests depend on them; update tests that assume “bill = gaming only” to the new combined meaning **explicitly**.
- Payment recording:
  - Input: `allocations: [{ chargeId, amountMinor }]` + method + currency + idempotency (hash includes allocations).
  - Validate every charge belongs to this session (gaming or linked POS).
  - Sum(allocations) = payment amount; each ≤ charge remaining; guest: sum === combined remaining.
  - Insert one payment + N allocations; update each charge status; ledger CREDIT once for full payment amount; outbox/audit.
- Fix `getPayment` session resolution: if charge is gaming/session use `sourceId`; if pos/order resolve via `gaming_session_order_links`.

**Gaming integrity check (required in tests):** gaming charge `total_minor` unchanged after POS activity.

### STEP 7 — APIs

- `GET/POST /api/catalog/products` (+ price endpoints as needed)
- `POST /api/gaming/sessions/:sessionId/pos/orders` (add drink / complete sale)
- `GET /api/gaming/sessions/:sessionId/checkout` — enriched view
- `POST /api/gaming/sessions/:sessionId/payments` — multi-allocation body  
  Update HTTP tests; do not leave dead single-allocation-only server code if schema changes.

### STEP 8 — Checkout UI

- Rebuild summary card in `checkout/page.tsx` + client sales-card (selection toggles, Pay / Pay All sections).
- Amounts and lines **only** from API.
- Add-drink on session detail (product picker).
- Minimal catalog admin page for products/prices.
- i18n `en`/`ar`; existing CSS tokens; RTL-safe; no full redesign.

### STEP 9 — Tests (definition of done)

Catalog, POS, finance multi-charge, FIFO (15+10+20 pay 20 then 25), guest reject 50 of 130, tenant isolation, gaming total immutability, idempotency, branch price override + historical snapshot.

### STEP 10 — Regression

- Existing `tests/finance/checkout.test.ts` + HTTP checkout suites green.
- Gaming billing/session tests untouched in intent.

### STEP 11 — Documentation

- `IMPLEMENTATION_STATUS.md`: M9 IN DEVELOPMENT → slice complete notes; inventory deferred.
- `UX_PRODUCT.md` / `PROJECT_STRUCTURE.md` / finance module header comment.
- Short note on POS-013 + ledger `drink` vs `order` coexistence.

---

## Explicit non-goals (log only)

Inventory balances/movements, purchasing, transfers, walk-in/counter POS, refunds/voids, cash shifts, receipts, wallet/loyalty, advanced reporting.

---

## Risks / open conflicts (need your OK, not silent fixes)

1. **Checkout totals meaning changes** from “gaming only” to “gaming + linked POS”. Existing UI copy and some tests assume gaming-only remaining — will be updated deliberately.
2. **Ledger ad-hoc `postDrink`** remains for customer account drinks; session checkout ignores unlinked `pos`/`drink` charges. Retiring ad-hoc drinks is **out of scope** unless you ask.
3. **One completed order per drink add** (simpler FIFO/Pay) vs multi-line open tab then complete — plan defaults to **one order per add**. Say if you want a single open tab order instead.
4. **Payment request shape change** — prefer multi-`allocations` as canonical; update all callers in one PR.

---

## Approval gate

**Approved** (human: 2026-09-24). Implementation follows STEP 3–11 for the session-linked NON_STOCK drink slice. Inventory / walk-in counter POS remain out of scope.
