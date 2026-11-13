# Implementation status

This file is a checkpoint, not unquestioned truth. After any interruption, inspect the repository and `git status`, then verify these claims before editing.

# Current Milestone

Platform adaptation (Vercel + Supabase PostgreSQL) is **IN DEVELOPMENT**. **UX / Product Consolidation Pass is IN DEVELOPMENT**; targeted authenticated browser and responsive verification passed locally on 2026-09-30. Milestones 1–8 are CLOSED. **Milestone 9 session-linked POS (NON_STOCK drinks) is IN DEVELOPMENT / slice landed** in the working tree (`0018`). Full M9 inventory remains deferred. Do **not** apply `0018` to hosted Supabase until a human authorizes it.

Real-money pilot: **CONDITIONAL GO** (not GO). See pre-pilot conditions below.

# Overall Status

**MILESTONE 8 CLOSED** (independent verdict 2026-08-27: PASS). Milestone 7 CLOSED (`ac74446`). Milestone 6 CLOSED (`0acfd8f`). Milestone 5 CLOSED (`53e120df`). Milestone 4 CLOSED (`eb64151`). Milestone 1 CLOSED. Milestone 2 CLOSED (`1d9427a`). Milestone 3 CLOSED (`04b89dca`). **Milestone 9 session-linked POS slice** authorized 2026-09-24 and landed in the working tree (inventory still deferred).

**Platform adaptation (Vercel + Supabase PostgreSQL):** IN DEVELOPMENT. Local adaptation is in the working tree; hosted Supabase and Vercel→Supabase verification are **not** complete. See `docs/operations/VERCEL_SUPABASE_DEPLOYMENT.md` and ADR 0009.

**UX / Product Consolidation Pass:** IN DEVELOPMENT. See `docs/architecture/UX_PRODUCT.md`. Design System P0–P2 (foundations, shell, shared primitives) is in the working tree. Targeted local browser smoke and the six requested responsive viewports passed; no full UX closure is declared. Not a substitute for M9 inventory.


# Completed

## Foundation Milestone 1 (verified 2026-08-25)

- Architecture DOCX + `GAMING_CENTER_BLUEPRINT.md`, Requirements, AGENTS.md, rules, ADRs 0001–0006
- Next.js modular monolith skeleton, SQL foundation migration `drizzle/0001_core_foundation.sql`

## Milestone 2 — Identity & Admin Core (2026-08-25)

- Better Auth, identity module, admin HTTP/UI, isolation and identity tests (git `598146f`)

## Milestone 2.1 — Security hardening (2026-08-25)

- **Migration `drizzle/0003_security_hardening.sql`:** dropped `app_bypass_rls()` and all policy uses; uniqueness on `auth_accounts (issuer, account_id)` and `lower(core_users.email)` where email is present; membership immutability trigger + INVITED→ACTIVE self-update RLS; `gaming_app` `NOSUPERUSER NOBYPASSRLS`
- **Runtime vs migration connections:** `DATABASE_URL` = `gaming_app` request path with `getSafeRuntimeDb()`; `MIGRATION_DATABASE_URL` required by `npm run db:migrate`
- **PostgreSQL test harness:** `npm run test:postgres` uses `vitest.postgres.config.ts` and runs only `tests/security/postgres-live.test.ts`. `npm test` still excludes that file.

## Milestone 2.1 closure — runtime role + live harness (2026-08-26)

- **Migration `drizzle/0004_runtime_role_enforcement.sql`:** fail closed if `gaming_app` cannot be pinned.

## Milestone 3 — Configuration & customer core (2026-08-26)

Reused foundation tables. Settings, features, customers. Seeded keys remain `gaming.billing_unit_seconds`, `gaming.allow_guest_sessions`.

## Milestone 4 — Gaming master data (CLOSED 2026-08-26)

Canonical areas, device types, devices, pricing plans/assignments. Occupied/free was **not** stored. No session engine.

## Milestone 5 — Gaming Floor & sessions (CLOSED 2026-08-26)

Canonical blueprint names. No billing engine. Occupancy is derived from ACTIVE/PAUSED `gaming_sessions`, not `gaming_devices.operational_status`.

- **Migration `drizzle/0007_gaming_sessions.sql` (forward-safe; does not rewrite 0001–0006):** `gaming_sessions`, `gaming_session_segments`, `gaming_session_pauses`; composite tenant/branch/device/customer FKs; lifecycle CHECKs; `uq_gaming_sessions_one_active_per_device`; open-segment and open-pause partial uniques; FORCE RLS; immutable ownership and closed-row triggers; `gaming.sessions.read` / `.start` / `.operate` / `.cancel` with OWNER backfill. Application has no session DELETE path. `gaming_app` still inherits DELETE from 0001 default privileges (same as prior tenant tables). `charge_id` / `gaming_total_minor` exist as nullable placeholders; no `finance_charges` FK and no amount calculation.
- **Lifecycle:** START → ACTIVE; PAUSE → PAUSED (pause row, `is_billable=false`); RESUME → ACTIVE; MOVE (same branch; close segment `MOVE`, open new snapshot); END → COMPLETED (close segment `SESSION_END`, clear `current_device_id`); CANCEL → CANCELLED (HIGH permission, MANAGE branch, required reason). `ENDING` is in the CHECK for later checkout and is unused. Server/database `now()` is used for lifecycle timestamps; client clocks are display-only.
- **Concurrency:** Start locks the device `FOR UPDATE`, then the branch `FOR UPDATE` (session-number allocation), then inserts. Move locks the session, then current and target devices in UUID order. Occupancy is also enforced by the partial unique index. Two concurrent starts on one device: one success, one conflict.
- **Pricing snapshot:** Deterministic resolver Device > Area > Device type > Branch > Organization, then `priority`, then later `valid_from`. Validity window remains `valid_from <= at AND (valid_to IS NULL OR valid_to > at)`, expressed with Drizzle `lte` / `isNull` / `gt` (not a raw `sql` Date bind — postgres.js rejects that). Snapshot JSON is stored on the segment. `computed_amount_minor` stays NULL.
- **Guest/customer:** `customer_id` NULL = guest; gated by `gaming.allow_guest_sessions` (org/branch setting). Same-org ACTIVE customers only. Guest → customer assign on an open session. No fake customer rows.
- **Permissions:** `gaming.sessions.read` (LOW, VIEW), `.start` (MEDIUM, OPERATE), `.operate` (MEDIUM, OPERATE: pause/resume/move/end/assign), `.cancel` (HIGH, MANAGE).
- **HTTP:** `GET /api/gaming/floor`, `GET|POST /api/gaming/sessions`, `GET /api/gaming/sessions/:id`, `POST .../pause|resume|end|cancel|move|customer`.
- **Admin UI:** `/admin/gaming/floor`, `/admin/gaming/sessions`, `/admin/gaming/sessions/:id`. Header “Floor” is permission-gated. Display timer is client-side from server timestamps.
- **Outbox:** facts written in the same transaction (`gaming.session.started` / `paused` / `resumed` / `moved` / `completed` / `cancelled` / `customer_assigned`). No worker, no WebSockets.
- **Not in M5:** charge calculation, POS, payments, debt, inventory, WebSockets, NFC, session notes column (not in blueprint), manual financial corrections, `ENDING` checkout flow.

## Milestone 6 — Pricing & billing engine (CLOSED 2026-08-27)

Interprets M5 operational facts financially. Does not collect payments or create `finance_charges`.

- **Migration `drizzle/0008_gaming_billing.sql`:** session `billing_finalized_at` / `billing_rule_version` / `billing_currency` / `billing_breakdown`; CHECK that those fields and `gaming_total_minor` are all null or all set on COMPLETED; one-time fill of amounts on closed COMPLETED rows; CANCELLED remains fully immutable; closed segments may fill `computed_amount_minor` once. No new tenant tables. No new permission codes.
- **Source of truth:** finalized `gaming_sessions.gaming_total_minor` + per-segment `computed_amount_minor` + stored `billing_breakdown` (rule version `gaming.billing.v1`). Historical rates come only from the immutable segment `pricing_snapshot`. M6 does not re-run Device > Area > Device type > Branch > Organization precedence.
- **Calculator:** pure integer math in seconds. TIME_BASED: `billed_duration = max(billable_seconds, minimum_billable_seconds)` then CEIL/FLOOR/NEAREST half-up units, `units * rate_minor`, then `max(amount, minimum_charge_minor)`. PACKAGE: full `package_price_minor` when `0 < billable_seconds <= package_duration_seconds`; zero-length PACKAGE is 0 then minimum charge; overage fails closed. Pause overlap uses stored `is_billable` (M5 writes `false`; not reinterpreted).
- **Finalization:** COMPLETED only. End-session auto-finalizes in the same transaction when calculation succeeds; otherwise the session still completes operationally with NULL totals. `POST .../billing/finalize` is idempotent (`SELECT FOR UPDATE` + `billing_finalized_at IS NULL`). Recalculation/overwrite is forbidden. CANCELLED is not billed.
- **Permissions:** `gaming.sessions.read` + VIEW for GET billing (PROVISIONAL on open sessions). `gaming.sessions.operate` + OPERATE to finalize. No manual override permission.
- **HTTP:** `GET /api/gaming/sessions/:id/billing`, `POST /api/gaming/sessions/:id/billing/finalize`.
- **UI:** session detail breakdown + finalize; history total column. No Pay / POS / receipts.
- **Outbox/audit:** `gaming.session.billing_finalized` in the same transaction.
- **Not in M6:** POS, payments, charges, refunds, debt, tax, discounts, receipts, inventory, NFC, WebSockets, FIXED auto-end, ENDING checkout, manual total edits.

## Milestone 7 — Checkout / payments / cashier core (CLOSED 2026-08-27)

Settles the canonical finalized M6 gaming amount. Does not recalculate pricing. Independent review: PASS — MILESTONE 7 CLOSED.

- **Source of truth:** `gaming_sessions.gaming_total_minor` + `billing_currency` + `billing_finalized_at`. Checkout copies that total onto `finance_charges` (`source_module=gaming`, `source_type=session`). Payment never writes billing columns.
- **Eligibility:** COMPLETED + finalized billing. Reject ACTIVE/PAUSED/ENDING, CANCELLED, unfinalized, corrupt NULL totals. `ENDING` remains unused.
- **Entities:** `finance_payment_methods`, `finance_charges`, `finance_charge_items`, `finance_payments` (COMPLETED only), `finance_payment_allocations`. Charge status OPEN / PARTIALLY_PAID / PAID is derived in the same transaction as allocations (`applied_total <= charge.total_minor`).
- **Methods:** Seeded per organization: CASH (`method_type=CASH`) and SHAMCASH (`method_type=MANUAL`, `recordingMode=MANUAL`). ShamCash is a staff-recorded method. Automated ShamCash API/webhooks: **NEEDS VERIFICATION / POTENTIAL INTEGRATION** — not implemented and not claimed.
- **Partial payments:** Explicitly required (POS-003, GAM-114). Customer may pay 1..remaining. Guest must pay remaining in full. Applied payments cannot exceed amount due. No cash-tender/change model (exact applied amount only).
- **Idempotency:** Required `Idempotency-Key` (header or body), scoped `finance.payments` per organization, 8–128 `[A-Za-z0-9._:-]`. SHA-256 request hash of session/amount/currency/method/reference. Exact retry returns the stored payment (`ON CONFLICT DO NOTHING` so PostgreSQL does not abort the transaction). Contradictory reuse → conflict.
- **Concurrency:** Lock session `FOR UPDATE`, lock/create charge `FOR UPDATE`, recompute remaining from allocations, insert payment + allocation. Constraint trigger rejects `sum(allocations) > charge.total_minor`. Two cashiers settling the same remaining amount: one success, one conflict. Applied total never exceeds the bill.
- **Immutability:** Payment/allocation/charge-item UPDATE/DELETE triggers. Charge amounts/source/currency immutable; status may advance to PAID. M6 billing columns remain trigger-blocked. `gaming_app` DELETE revoked on session history and finance tables (0009).
- **Permissions:** `finance.payments.read` (LOW) and `finance.payments.create` (HIGH). GET checkout/history: `gaming.sessions.read` + VIEW. POST payment: `finance.payments.create` + OPERATE. VIEW cannot record.
- **HTTP:** `GET /api/gaming/sessions/:id/checkout`, `GET|POST /api/gaming/sessions/:id/payments`, `GET /api/finance/payments/:id`. No payment PATCH/amount edit.
- **UI:** Session detail links to `/admin/gaming/sessions/:id/checkout`. Cashier sees finalized amount, paid, due, methods, history. ShamCash copy states staff-recorded, not provider-verified.
- **Outbox/audit:** `finance.charge.created`, `finance.payment.completed`, `finance.charge.settled` in the same transaction as persistence.
- **PACKAGE multi-segment:** M6 per-segment package price remains canonical. Checkout accepts that total. No package pooling.
- **Not in M7:** POS catalog, inventory, cash shifts/registers, expenses, refunds/voids, receipts, customer debt ledger, FX, card acquiring, WebSockets, NFC.

## Milestone 8 — Production hardening & pilot readiness (CLOSED 2026-08-27)

Independent review: PASS — MILESTONE 8 CLOSED. Pilot readiness: **CONDITIONAL GO** (not GO). Prepare M1–M7 for a controlled real-world pilot. Not a feature-expansion milestone. Not M9 POS catalog/inventory.

- **CSRF:** Production mutations require `Origin` === `APP_BASE_URL` origin. Missing Origin is denied in production. No localhost default for `APP_BASE_URL` in production. SameSite=Lax + HttpOnly cookies remain. Not token CSRF. Cross-origin admin clients are out of scope.
- **Cookies:** Better Auth cookies HttpOnly, SameSite=Lax, Secure when `NODE_ENV=production`. Session 7 days (lifetime still NEEDS DECISION). Sign-out still clears `gc_organization_id`.
- **Env:** `assertRuntimeEnvironment()` at Node bootstrap (`instrumentation.ts`), skipped during `next build`. Production requires `DATABASE_URL` user `gaming_app`, distinct `MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET` ≥ 32 chars, `APP_BASE_URL`.
- **Headers:** nosniff, DENY framing, referrer policy, Permissions-Policy, conservative CSP. HSTS is the TLS terminator’s job.
- **Health:** `GET /api/health/live`, `GET /api/health/ready` (DB `SELECT 1`). Generic bodies.
- **Logging:** JSON lines with `requestId` (`x-request-id`). Secrets and DB URLs redacted. Unexpected API errors return generic 500 + `requestId`; stack stays server-side.
- **DB privileges:** Forward migration `0010_pilot_hardening.sql` revokes runtime DELETE on audit, outbox, customers, orgs/branches/users/memberships/roles, gaming masters, `auth_users`. DELETE kept on setting values, branch access, role/membership maps, and auth sessions/accounts/verifications. Default privileges no longer grant DELETE on new tables.
- **PACKAGE:** Fail closed on multi-segment PACKAGE (MOVE rejected; billing rejected). Single-segment PACKAGE still bills. Not a pooling rule.
- **Reports:** `/admin/reports` and `GET /api/reports` — sessions by day, gaming billed (finalized only), payments recorded by method, outstanding charges, device usage, cashier activity. Integer minor units. CSV optional. Requires `gaming.sessions.read` + `finance.payments.read` + branch VIEW.
- **Docs:** `docs/operations/PILOT_RUNBOOK.md`, `DEPLOYMENT_RUNBOOK.md`, `BACKUP_RESTORE.md`, `PILOT_CHECKLIST.md`.
- **Not in M8:** Full inventory, refunds, debt ledger, cash shifts, ShamCash API, MFA, Manager/Cashier templates, hosting vendor choice. Session-linked NON_STOCK POS is tracked under Milestone 9 (below).
- **Users page production RSC (2026-08-27):** `/admin/users` was a Server Component passing `buildAction` / `buildBody` functions into client `SelectAction`, which crashes under `next start`. Fixed by passing a serializable `actionTemplate` (`{value}` placeholder) and static `body`. Client substitutes `{value}`. Authorization still lives on the memberships/roles/branch-access APIs (`core.memberships.manage`). Regression: `tests/admin/rsc-select-action.test.ts`. Production `next start` re-check: create user, role assignment, and branch grant **PASS**.
- **Customer duplicate warnings:** Create UI surfaces non-blocking duplicate phone/email warnings.
- **Independent closure:** PASS — no HIGH, no blocking MEDIUM. HIGH 0. Blocking MEDIUM 0.

## Milestone 9 — Session-linked POS (NON_STOCK slice) — IN DEVELOPMENT (authorized 2026-09-24)

Authorized plan: `Code/PLAN.md`. Gaming billing (M6) and single-session charge creation remain unchanged. Checkout totals are **gaming + linked POS**.

- **Migration `drizzle/0018_pos_catalog_orders.sql`:** `catalog_categories`, `catalog_products`, `catalog_product_prices`, `pos_orders`, `pos_order_items`, `gaming_session_order_links`; permissions `pos.catalog.*` / `pos.orders.*` + OWNER backfill; RLS.
- **Catalog:** create product + org/branch prices; server price resolve; `/admin/catalog`; `GET|POST /api/catalog/products`.
- **POS:** one completed order + `pos`/`order` charge per drink add on ACTIVE/PAUSED; session link; add-drink on session detail; `POST /api/gaming/sessions/:id/pos/orders`.
- **Finance:** multi-charge checkout view (`play` + `drinks`); FIFO derived from allocations; multi-allocation payments; guest must pay **combined** remaining; coexistence with ad-hoc ledger `pos`/`drink` (checkout ignores unlinked drinks).
- **UI:** checkout sales card; Products nav when `pos.catalog.read`.
- **Tests:** `tests/finance/fifo.test.ts`, `tests/pos/session-pos.test.ts`, migration 0018 assertion; existing checkout suites remain green.
- **Not in this slice:** inventory balances/movements, walk-in/counter POS, refunds/voids, cash shifts, receipts, purchasing.

# In Progress

**UX / Product Consolidation Pass — IN DEVELOPMENT.** Not Milestone 9. Automated verification plus smoke-path i18n/session/Guided Setup are in the working tree. Targeted browser smoke passed against a local disposable database and the production build on 2026-09-30. See `docs/architecture/UX_PRODUCT.md` and `AUDIT_EXECUTION_REPORT.md` at the repository root.

Working-tree UX: Better Auth session reuse on `/` and `/login`; presentation locale/theme cookies; Guided Setup; Design System P0–P2. Additive slices in the tree: till withdrawals (`0015`), staff soft-revoke (`0016`, disable now / anonymize after 30 days, `/access-revoked`), devices+types merged like the wizard, floor shows priced stations only (occupied unpriced remain), drawer backdrop hover uses a light scrim. Billing arithmetic and snapshots were not changed. `/admin/gaming` remains the floor-setup hub. Do **not** apply 0015/0016 to hosted Supabase until a human authorizes them.

Approved TIME_BASED billing is `PRORATED_HOUR` (nearest 5 minutes, nearest 5 currency units, HALF-UP, integer/rational only) with legacy `UNIT` preserved. Local additive migration `0013_prorated_hour_billing.sql` distinguishes those modes. Do **not** apply 0013 to hosted Supabase until a human authorizes it. First-owner `/setup` bootstrap is unchanged.

Platform adaptation (Vercel + Supabase PostgreSQL) — IN DEVELOPMENT. Not Milestone 9. First-owner HTTP bootstrap hardening is in the working tree (`0012_platform_bootstrap.sql`). Hosted Supabase apply of 0012 and Vercel redeploy verification are still required before calling the adaptation complete.

# Remaining

Intentionally open debt (does not reopen Milestones 2–8). M8 reclassified PACKAGE as a **pilot restriction** (fail closed), not silently accepted money:

- **PACKAGE + MOVE:** Fail closed. Blueprint still does not define session-level package pooling. Product may later define pooling (NEEDS DECISION).
- **Backup role / pilot conditions:** Production `pg_dump`/`COPY` requires `BYPASSRLS` (or a tightly controlled backup-only superuser). Table owner and `gaming_app` cannot dump FORCE RLS tables. Dedicated backup credentials are not provisioned until hosting is chosen. Real-money pilot remains **CONDITIONAL GO**.

Intentionally open **LOW** debt (re-evaluated for pilot; not all fixed):

- **LOW — first setting-insert audit `entityId`:** First organization/branch setting insert may record `entityId = null`.
- **LOW — ENTITY setting-scope CHECK:** Database CHECK allows ENTITY-scoped setting values; APIs do not expose entity settings.
- **LOW — settings table overflow:** Settings admin table can overflow on narrow screens. Tables use `.table-scroll`; not a full redesign.
- **LOW — independently verified edge cases:** Some independently verified edge cases are not yet encoded in shipped tests.
- **LOW — live PostgreSQL attack encoding:** Some M3 direct `gaming_app` attacks are not fully encoded in `postgres-live.test.ts`.
- **LOW — admin detail UI vs branch VIEW:** Area/device detail pages show Edit/Archive when the actor has `gaming.master.manage` even if branch access is only VIEW. The server still denies the mutation.
- **LOW — no pricing-plan edit screen:** PATCH exists; admin UI creates and archives plans but has no edit form.
- **LOW — archive audit snapshots:** Area/device-type/device archive audit `before`/`after` are thinner than create/update snapshots.
- **LOW — Drizzle CHECKs vs SQL:** Drizzle does not mirror every SQL CHECK. PostgreSQL remains authoritative.
- **LOW — HTTP matrix vs use-case:** Some permission/branch-mode cases are covered in module tests rather than every HTTP route.
- **LOW — `auth_users.email` casing:** `auth_users.email` uniqueness remains case-sensitive. `core_users` is case-insensitive. Better Auth typically stores one spelling; concurrent mixed-case duplicates are unlikely in a small pilot. Do not rewrite the identity unique index without a dedicated auth migration review.
- **LOW — history device column:** Completed sessions show `current_device_id = —`; device identity is on segments / the detail page.
- **LOW — end auto-finalize HTTP payload:** If calculation fails, `endSession` still returns HTTP 200 with `gamingTotalMinor: null`. Detail billing after refresh shows UNFINALIZED/error; history shows `—`, not `0`.
- **LOW — live PostgreSQL M6 encoding:** Concurrent finalize, tenant hide, and UPDATE immutability are in `postgres-live.test.ts`. Snapshot-after-plan-change and same-org cross-branch billing are PGlite/module coverage, not dedicated live assertions.
- **LOW — live PostgreSQL M7 catalog breadth:** Concurrent overpay, idempotent replay, tenant hide, payment UPDATE/DELETE, session DELETE, and `has_table_privilege` for sessions/payments/charges/audit/customers/devices are in `postgres-live.test.ts`. Direct allocation-cap INSERT, same-key concurrent insert, charge-row count, and DELETE privilege on segments/pauses/items/allocations are not dedicated live assertions.
- **LOW — payment amount vs allocation amount:** Application inserts equal amounts. PostgreSQL caps `sum(allocations) <= charge.total_minor` but does not require allocation totals to match `finance_payments.amount_minor`.
- **LOW — persisted charge status:** Checkout settlement is derived from allocations vs charge total. `finance_charges.status` is updated in the same payment transaction; it is not constraint-synced to allocations.
- **LOW — HTTP vs module payment rejections:** Auth/idempotency/settled/cross-tenant are HTTP tests. Unfinalized, cancelled POST, zero, overpay, and currency mismatch are module coverage.
- **LOW — device-usage billed double-count on MOVE:** Device-usage `sessionCount` is distinct sessions; `gamingBilledMinor` sums session totals per matching segment. TIME_BASED MOVE can attribute the same finalized bill more than once. Ledger/payments are unaffected. Canonical billed figure is sessions-by-day. Do not treat device-usage billed as a revenue split.
- **LOW — nested log redaction:** Structured redaction is key-based and shallow. Nested objects are not recursively redacted.
- **LOW — restore leftover audit UPDATE vs trigger:** After the disposable FORCE-RLS-suspension restore drill, `core_audit_logs` may still show table UPDATE in default ACL. The append-only trigger still rejects UPDATE (`core_audit_logs is append-only`). Live tests assert UPDATE revoked after migrate, before dump. Not a bypass. Not a production restore procedure.
- **LOW — `NEXT_PHASE` operator footgun:** Production env assertion is skipped when `NEXT_PHASE=phase-production-build` so `next build` stays credential-free. Mis-setting that phase at runtime would skip fail-closed checks.
- **LOW — live-test breadth:** Some independently verified edge cases remain module/PGlite coverage rather than dedicated live PostgreSQL assertions.
- **LOW — homepage stale finance copy:** `/` still says finance is not implemented. Stale marketing copy only; checkout/payments exist.
- **LOW — reports range test gap:** 31-day cap is enforced in `assertRange`; there is no dedicated unit test for that bound.
- **LOW — CSV formula escaping gap:** CSV quotes commas/quotes; leading `=` / `+` / `-` / `@` formula injection is not escaped.

# Needs Decision

- Final auth policy: password vs magic-link vs both, MFA, password reset, session lifetime (ADR 0003/0007)
- Invitation email transport; platform provisioning / platform-admin (ADR 0004)
- Manager/Cashier role template permission sets (only OWNER is seeded)
- Organization suspension/archival triggers (platform concern)
- Production host and managed PostgreSQL vendor: **Vercel + Supabase PostgreSQL** chosen for platform adaptation (ADR 0009). Commercial Vercel plan and backup-role provisioning remain **NEEDS DECISION**.
- Currency fraction digits / tax (ADR 0005)
- **Pause billable default (GAM-107):** M5 stores `is_billable=false` on pause rows and does not add a setting. M6 honors the stored fact; future default remains NEEDS DECISION.
- Additional MVP setting keys (cash-shift rules, default payment methods/pricing) — ADR 0006 / POS-008
- Unique customer phone/email (FUN-006)
- Canonical device-type category vocabulary
- Object storage vendor; realtime transport (SSE vs WebSocket) — polling/refresh is the M5 floor approach
- Whether FIXED sessions auto-end at `requested_end_at` (column exists; no worker in M5/M6; M6 bills actual elapsed time)
- Whether M7 uses `ENDING` during checkout; unused in M5/M6/M7. Operational COMPLETED + one-time billing fill is sufficient.
- Cash overpayment / change-due (M7 records exact applied amount only)
- Whether ShamCash `requires_reference` must be true (M7 optional)
- ShamCash automated verification / provider API — **NEEDS VERIFICATION / POTENTIAL INTEGRATION**
- Void / refund / reversal workflows (tables not added; POS-005 remains later)
- Fiscal receipt generation (payment confirmation is not a receipt)
- Cashier shifts / registers / cash counts (POS-008)
- Customer debt ledger / accounts receivable (outstanding amount is visible; GAM-012 still applies to guests)
- PACKAGE overage / exhaustion and multi-segment PACKAGE allocation (M6 fails closed on overage; per-segment package price otherwise)
- CANCELLED session billing (M6/M7 do not bill or accept payment on cancelled sessions)
- Whether start must fail when no pricing assignment exists (implemented fail-closed so a snapshot can be stored; product could later allow an explicit exception)
- Guest display-name requirement (blueprint: guest without name/phone is allowed)
- Manual session time correction / billing override workflows (not in M5/M6)
- Pilot site, backup RPO/RTO, personal-data retention
- Stronger CSRF (tokens) before cross-origin admin clients (same-origin Origin gate is now production-required; ADR 0008 still forbids cross-origin admin without a new decision)
- Observability vendor / APM (stdout JSON is the pilot default)
- RPO/RTO business sign-off (engineering proposal: 24h / 4h)

# Blockers

Hosted Supabase TEST project credentials are not in this workspace, so `npm run test:supabase` live proof and Vercel→Supabase deploy proof are **BLOCKED BY ENVIRONMENT**. Local PostgreSQL verification is still required. Milestone 8 remains CLOSED. Disposable DB `gaming_center_security_test` remains the only approved **local** live-test target. Do not start Milestone 9 until a human explicitly authorizes it.

# Pilot status

**CONDITIONAL GO** — not GO. Technical M8 closure does not authorize taking real customer money.

Exact pre-pilot conditions (all required):

1. Hosting chosen and provisioned
2. Managed PostgreSQL (not ephemeral disk)
3. Runtime `gaming_app` pinned NOSUPERUSER / NOBYPASSRLS / NOCREATEDB / NOCREATEROLE / NOINHERIT / LOGIN
4. Separate migrator credentials; never used as `DATABASE_URL`
5. Dedicated BYPASSRLS (or backup-only superuser) dump/restore path — not `gaming_app`
6. Encrypted off-box backups; restore ownership defined
7. Owner approval of RPO/RTO (engineering proposal 24h / 4h until then)
8. Public https `APP_BASE_URL` matching the real hostname; unique ≥32-character `BETTER_AUTH_SECRET`
9. Real center bootstrapped through the admin UI (not ad-hoc SQL)
10. Staff briefing: PACKAGE+MOVE forbidden; no refunds/voids; ShamCash is staff-recorded; reports are not accounting revenue; device-usage billed is not a revenue split

# Recovered issues / environment notes

- **Global npm cache ENOENT (M1, recovered).** Use the project-local cache: `npm install --cache .tmp-npm-cache`.
- **npm peer resolution:** install with `--legacy-peer-deps` when adding packages.
- **PowerShell 5.1:** `&&` is not a statement separator; use `;`.
- **Typecheck vs `next build`:** do not run `tsc` in parallel with `next build`; `.next/types` is rewritten and `tsc` can fail with missing generated files.

# Last Verification

Audit execution on 2026-09-30 (this working tree, not committed):

- `npm run typecheck`: PASS.
- `npm run lint`: PASS, zero warnings.
- `npm test`: PASS, 115 files / 635 tests. The live PostgreSQL and hosted Supabase suites are excluded by the standard Vitest configuration.
- `npm run build`: PASS.
- Local disposable PostgreSQL browser fixture: reset and seed twice with identical counts (2 synthetic organizations, 3 branches, 2 devices, 2 customers, 1 product, 3 users); non-loopback target rejected before connection. Runtime `gaming_app` role assertion passed.
- Authenticated browser smoke against the production build: PASS, eight flow groups including owner/staff login, customer CRUD, floor/session/POS, checkout retry, denied staff mutations, cross-tenant 404, and logout. Expected 401/403/404 responses were observed; no unexpected console or HTTP failures. `Code/.tmp-browser-artifacts/smoke-results.json` is local-only evidence.
- Responsive browser audit against the production build: PASS, 60/60 page-locale-viewport cases (six exact viewports, Arabic RTL and English LTR, dashboard/floor/customers/unpaid checkout/confirmation). `Code/.tmp-browser-artifacts/responsive-results.json` is local-only evidence.
- `npm run test:postgres` and hosted `npm run test:supabase`: not run in this audit. Hosted Supabase was not touched. Pilot remains **CONDITIONAL GO**.

Independent Milestone 8 closure (2026-08-27): **PASS — MILESTONE 8 CLOSED**. Pilot: **CONDITIONAL GO**. HIGH 0. Blocking MEDIUM 0.

Design System P0–P2 local commands (2026-08-29, this working tree, not committed):

- Typecheck: PASS (`npm run typecheck`)
- Lint: PASS (`npm run lint`)
- Tests: PASS (`npm test` — 51 files, 339 tests; `postgres-live` and `supabase-hosted` excluded). Includes theme cookie/bootstrap tests and unauthenticated `POST /api/ui/theme`. Billing v2 / 0013 tests still pass.
- Build: PASS (`npm run build`)
- `npm run test:postgres`: **not run**
- `npm run test:supabase` live: **not run**
- Hosted DB: **not mutated**. Nothing committed, pushed, or deployed.

Platform adaptation local commands (2026-08-28, this working tree, not committed):

- Typecheck: PASS (`npm run typecheck`)
- Lint: PASS (`npm run lint`)
- Tests: PASS (`npm test` — 42 files, 283 tests; `postgres-live` and `supabase-hosted` excluded). Includes a clean PGlite apply of `0012` asserting `signup_claimed_at` is a real column.
- Build: PASS (`npm run build`)
- `npm run test:postgres`: **BLOCKED BY ENVIRONMENT** (`GAMING_TEST_DATABASE_URL` unset in this session; live tests skipped). Do not point this suite at hosted Supabase. Concurrent bootstrap claim is encoded in `postgres-live.test.ts`. PGlite HTTP concurrency still asserts a single `core_users` row.
- `npm run test:supabase` live: **not run** (no hosted TEST project credentials)
- Vercel → Supabase deploy of this bootstrap fix: **not run** (code not yet deployed). Hosted proof requires applying `0012` then the operator bootstrap procedure in `VERCEL_SUPABASE_DEPLOYMENT.md`.
- `0012` pre-apply review: `signup_claimed_at` is present in `CREATE TABLE` (not a missing-column bug). SQL was not rewritten. Hosted Supabase was not modified.

# Database State

Disposable `gaming_center_security_test` is the approved **local** live-test database. Runtime LOGIN `gaming_app` must remain NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE/NOINHERIT/LOGIN and must not own tenant tables. Forward migration `0012_platform_bootstrap.sql` extends 0001–0011 and must not rewrite them. Hosted verification uses a dedicated Supabase TEST project and `npm run test:supabase`, never `test:postgres` pointed at Supabase.

# Discrepancies (blueprint vs implementation — do not redesign)

- Blueprint `data_type` / `validation_schema` / `scope_policy` vs implemented `value_type` / `allowed_scopes` (STRING/NUMBER/BOOLEAN/JSON/ENUM).
- ENTITY setting scope exists in schema; APIs do not expose entity settings.
- Blueprint session `charge_id` FK to `finance_charges` is added in 0009 when a charge is created at first payment.
- Blueprint end-session payment/charge creation is split: M6 finalizes `gaming_total_minor`; M7 creates the charge at first payment from that frozen total.
- Blueprint `ENDING` status is in the CHECK and unused. M7 does not adopt it.
- Permissions `finance.payments.read` / `.create` follow the blueprint `finance.payments.create` example; read is added so checkout history is not overloaded onto role names.
- Cash shifts, refunds, and inventory remain unimplemented despite being in the blueprint finance/POS chapters. Session-linked NON_STOCK catalog/POS (`0018`) is in the working tree. Till withdrawals (`finance_expenses`, migration `0015`) are implemented without cash shifts.
- Permissions `gaming.sessions.read` and `gaming.sessions.operate` are added so floor/history and pause/resume/end/move are not overloaded onto `gaming.sessions.start` / `cancel` only. M6 reuses those codes (no `gaming.billing.*` codes).

# Recommended Resume Point

Use the 2026-09-30 audit report and browser results as the local verification baseline. Continue **platform adaptation** only with a dedicated hosted TEST project and approved deployment plan until hosted Supabase + Vercel→Supabase are verified. Do not declare the adaptation complete from local tests alone. Do **not** run `npm run test:supabase` against the hosted project that now contains the real first owner. Milestone 8 remains CLOSED. Real-money pilot remains **CONDITIONAL GO**. Milestone 9 session-linked POS slice is in the working tree; do **not** apply `0018` (or 0013–0017) to hosted Supabase until authorized. Inventory / walk-in POS remain deferred.

Exact resume point if interrupted: inspect the working tree and `AUDIT_EXECUTION_REPORT.md`; local finance/POS tests and authenticated checkout/add-drink smoke have passed. Continue remaining product acceptance and hosted platform adaptation only under the existing authorization boundaries. Do not declare Milestone 9 CLOSED until inventory policy and remaining POS non-goals are explicitly scoped or deferred by a human.

# Last Updated

2026-09-30 — Audit TODO-001–012 reconciliation completed locally; targeted browser smoke and responsive checks passed against a disposable database and production build. Hosted verification and pilot conditions remain open. No commit/push/deploy.
