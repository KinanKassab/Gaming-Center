# Codex TODO

هذه المهام مرتبة حسب الاعتماديات. كل ما يلي يحتاج تغيير كوداً لاحقاً؛ لم تُنفّذ أي إصلاحات أثناء التدقيق.

## Phase 1 — Critical Fixes

### TODO-001
Title: Restore TypeScript and production build

Priority:
HIGH

Files:
- `Code/src/ui/smart-device-search.ts`
- `Code/tests/ui/smart-device-search.test.ts`

Problem:
`numberTokenMatches` infers `numbers` as `never[]`; `numbers.includes(digits)` fails typecheck and stops build.

Current behavior:
`npm run typecheck` fails at line 108 with TS2345. `npm run build` compiles application chunks, then fails at the same type error.

Expected behavior:
Search implementation has an explicit `string[]` result and preserves numeric matching behavior for Arabic/Latin digits and code boundaries.

Implementation requirements:
- Add a narrow type annotation or equivalent safe narrowing.
- Preserve current number normalization and behavior.
- Do not suppress TypeScript globally or weaken the search tests.

Acceptance criteria:
- `npm run typecheck` passes.
- `npm run build` passes.
- Existing `tests/ui/smart-device-search.test.ts` passes, including 10 vs 100 and digit normalization.

Verification:
Run `npm run typecheck`, `npm test -- tests/ui/smart-device-search.test.ts`, `npm run lint`, and `npm run build`.

---

### TODO-002
Title: Remove callback props from customer statement server/client boundary

Priority:
HIGH

Files:
- `Code/src/app/customer/view/[token]/page.tsx`
- `Code/src/app/admin/customers/[customerId]/page.tsx`
- `Code/src/app/_components/customer-statement.tsx`
- `Code/tests/admin/rsc-select-action.test.ts`

Problem:
Both customer statement pages pass `kindLabel` functions to `CustomerStatementTable`, which is a Client Component. The public page passes an inline callback; the admin detail passes a server-created function value.

Current behavior:
The RSC contract test identifies the public page as an offender. The admin detail uses the same non-serializable function prop and is not detected by the current regex test.

Expected behavior:
Both statement pages render in Arabic and English without serializing a function across the server/client boundary.

Implementation requirements:
- Pass serializable locale/label data and resolve labels within the client component, or render the statement table on the server.
- Extend the RSC test to detect named function variables passed as client props, not only inline arrows.
- Keep both public token behavior and admin permission checks unchanged.

Acceptance criteria:
- No function prop crosses either page/component boundary.
- A valid public portal token renders statement rows and localized transaction labels.
- Admin customer detail renders the same labels for an authorized reader.
- `tests/admin/rsc-select-action.test.ts` passes.

Verification:
Run focused RSC/customer tests, then full `npm test`, `npm run typecheck`, and `npm run build`.

---

### TODO-003
Title: Bring isolation and RLS fixtures up to current customer schema

Priority:
HIGH

Files:
- `Code/tests/isolation/tenant-isolation.test.ts`
- `Code/tests/security/rls-hardening.test.ts`
- Any shared customer SQL fixture found by search
- `Code/tests/helpers/identity.ts` if a shared customer factory is appropriate

Problem:
Direct test inserts omit `core_customers.portal_token`, which is NOT NULL in the current schema.

Current behavior:
12 isolation/RLS tests fail during fixture insertion before exercising their assertions. Full suite result was 613 passed, 13 failed.

Expected behavior:
Fixtures satisfy all current required columns and the tests execute their cross-tenant/RLS assertions.

Implementation requirements:
- Give each customer fixture a unique UUID portal token.
- Prefer a shared factory only if it removes actual duplication without hiding tenant/branch ownership.
- Keep tenant A/B and organization/branch mismatch cases intact.
- Do not change or skip assertions to make tests pass.

Acceptance criteria:
- All 12 tests reach their intended assertion and pass.
- The migration/schema test still confirms `portal_token` is required and indexed uniquely.
- Full `npm test` passes.

Verification:
Run `npm test -- tests/isolation/tenant-isolation.test.ts tests/security/rls-hardening.test.ts`, then `npm test`.

## Phase 2 — Functional Fixes

### TODO-004
Title: Add pagination to customer search

Priority:
MEDIUM

Files:
- `Code/src/app/admin/customers/page.tsx`
- `Code/src/app/api/customers/route.ts`
- `Code/src/modules/customers/customers.ts`
- Customer list URL/query and module tests

Problem:
The UI renders at most 50 customers and has no next/previous controls or cursor. The service accepts a limit but no offset/cursor, and the page does not expose the API limit.

Current behavior:
Customers beyond the first 50 are not reachable by browsing the list; search can find some records, but there is no indication of additional pages.

Expected behavior:
Users can move through the full organization-scoped customer list while keeping query and status filters in the URL.

Implementation requirements:
- Choose a stable ordering with a deterministic tie-breaker.
- Add bounded pagination using the project’s existing paging convention where possible.
- Return enough metadata for next/previous or cursor controls.
- Preserve tenant scoping, branch-independent customer ownership, and existing duplicate/archive behavior.

Acceptance criteria:
- More than 50 seeded customers can all be reached.
- Search and status filters persist across pages, refresh, and back/forward.
- API rejects invalid/unbounded paging inputs.
- Desktop table and mobile record cards show equivalent records.

Verification:
Add module/API tests for page boundaries, stable ordering, filters, and tenant isolation; run the customer tests and lint/typecheck.

---

### TODO-005
Title: Announce login errors accessibly

Priority:
MEDIUM

Files:
- `Code/src/app/login/login-form.tsx`
- `Code/tests/ui/accessible-name.test.ts` or focused login accessibility test

Problem:
Invalid-credentials feedback is inserted as a plain paragraph without an alert/live-region semantic.

Current behavior:
The message is visible after a failed sign-in, but assistive technology is not guaranteed to announce the new error.

Expected behavior:
The error is announced when it appears and remains associated with the sign-in form.

Implementation requirements:
- Add appropriate live-region/alert semantics and, if useful, `aria-describedby` association.
- Keep provider messages sanitized and retain localized copy.

Acceptance criteria:
- Invalid login error is announced once without forcing focus away from entered fields.
- Labels, keyboard submission, busy state, and credential-safe URL behavior remain intact.

Verification:
Run focused accessibility/login tests and manually submit invalid credentials in Arabic and English.

## Phase 3 — UX Fixes

### TODO-006
Title: Create a deterministic local browser smoke fixture

Priority:
MEDIUM

Files:
- `Code/scripts/` (new disposable-only seed/reset workflow if approved by repository conventions)
- Browser smoke test configuration and documentation under `Code/`

Problem:
The current local database has four auth users but no organization or memberships, while `/setup` is closed because at least one Core User exists. No known test credential can reach the admin UI, so dashboard, CRUD, staff, and cashier flows could not be audited.

Current behavior:
Browser smoke stops after unauthenticated route guards; no CRUD flow can be completed safely.

Expected behavior:
Developers can start an isolated disposable database with a synthetic owner, organization, branch, devices, price, customer, and catalog product.

Implementation requirements:
- Use only a clearly named disposable local/test database; fail closed on any other host/database.
- Never include production or real user credentials.
- Do not automatically apply migrations to hosted Supabase.
- Make reset behavior explicit and separate from ordinary development startup.

Acceptance criteria:
- Seeded owner can sign in and reach `/admin` with one organization and one branch.
- A second low-privilege user can be seeded for authorization checks.
- Reset refuses unless the configured disposable database name/guard matches.

Verification:
Run the seed twice safely, verify expected fixture counts, and test that a non-disposable URL is rejected.

---

### TODO-007
Title: Add authenticated browser smoke coverage for critical workflows

Priority:
MEDIUM

Files:
- Browser test configuration and smoke specs under `Code/tests/` or established E2E location
- Depends on: TODO-001, TODO-002, TODO-003, TODO-006

Problem:
The audit could not exercise create/edit/archive, floor session lifecycle, checkout, POS add-drink, staff permission denial, or branch switching through the UI.

Current behavior:
HTTP unit/integration tests exist, but no browser automation dependency or authenticated E2E flow is present in `package.json`.

Expected behavior:
Critical owner/operator/cashier flows run against the disposable fixture and report console/network failures.

Implementation requirements:
- Add the smallest browser runner that fits existing tooling.
- Cover customer create/edit/archive, branch and device filtering, session start/pause/resume/end, checkout retry, POS drink add, and a denied branch/permission action.
- Keep destructive financial history out of cleanup; isolate test state by disposable DB.
- Capture console errors and failed requests.

Acceptance criteria:
- Each listed flow reaches a visible success or expected denial state.
- No cross-tenant or unauthorized-branch action succeeds.
- Duplicate checkout submission creates no duplicate financial effect.

Verification:
Run smoke tests from a clean disposable database and record the final test report.

## Phase 4 — UI Fixes

لا توجد مهمة إصلاح مرئي مؤكدة من الصفحات التي أمكن عرضها. تُسجّل أي ملاحظات بعد تنفيذ TODO-006 وTODO-007، مع لقطات/أدلة لكل مشكلة.

## Phase 5 — Responsive Fixes

### TODO-008
Title: Exercise responsive admin layouts in a real browser

Priority:
MEDIUM

Files:
- Browser E2E viewport suite from TODO-007
- `Code/src/app/globals.css` and affected page/component files only if defects are reproduced
- Depends on: TODO-006, TODO-007

Problem:
Requested viewport widths were not exercised. Static shell tests cover 390/900/1440 logic, but do not prove rendered tables, dialogs, forms, and navigation fit.

Current behavior:
Only the public login page was visually inspected at 1280×720; no authenticated admin view was tested at mobile/tablet sizes.

Expected behavior:
The admin shell and representative operational flows remain usable at 1440, 1280, 1024, 768, 390, and 375 pixels.

Implementation requirements:
- Use browser viewport emulation and check horizontal overflow, clipped text, dialogs, navigation, tables/cards, and touch targets.
- Include Arabic RTL and English LTR at 390 and 1280 minimum.
- Make code changes only for reproduced defects, preserving desktop behavior.

Acceptance criteria:
- No document-level horizontal overflow at all six widths on dashboard, floor, customers, checkout, and a confirmation dialog.
- Forms and important actions remain visible and reachable by keyboard/touch.
- Existing `shell-layout` tests pass.

Verification:
Run the viewport suite and retain a concise pass/fail matrix for all six sizes.

## Phase 6 — Security

### TODO-009
Title: Remove temporary localhost debug telemetry

Priority:
MEDIUM

Files:
- `Code/src/middleware.ts`
- `Code/src/auth/setup-page-redirect.ts`
- `Code/src/app/_components/hard-redirect.tsx`
- `Code/src/app/admin/layout.tsx`
- `Code/src/app/admin/_components/admin-shell.tsx`
- `Code/src/app/admin/gaming/sessions/page.tsx`

Problem:
Temporary debug fetches send route/query/navigation state to a hard-coded loopback endpoint.

Current behavior:
Requests are attempted during middleware/page/client execution and failures are silently ignored.

Expected behavior:
Application behavior has no hidden telemetry endpoint or route/query exfiltration.

Implementation requirements:
- Remove debug markers, fetch calls, debug headers, and related payloads.
- Keep actual redirect and request behavior unchanged.
- Search all runtime source for the endpoint and agent-log markers.

Acceptance criteria:
- No runtime source references `127.0.0.1:7293`, `pre-fix`, or the removed debug session.
- Navigation/auth tests pass.
- Browser network capture shows no such request.

Verification:
Run `rg` over runtime source and relevant tests; run middleware/setup/redirect tests and browser smoke.

---

### TODO-010
Title: Sanitize nested exception data before logging

Priority:
MEDIUM

Files:
- `Code/src/core/log.ts`
- `Code/tests/core/` logging tests
- Depends on: none

Problem:
Field redaction only scans top-level fields; nested error `message` and `stack` are emitted afterward without applying the redactor.

Current behavior:
An exception containing a token, credential, or database URL could put it into logs if a dependency includes it in its message/stack.

Expected behavior:
Logs retain useful error category/request IDs while removing secret values recursively or omitting unsafe exception text.

Implementation requirements:
- Apply bounded recursive sanitization to nested values and strings in error name/message/stack.
- Avoid logging request bodies, cookies, or raw connection strings.
- Add sentinel tests for nested token/password/database URL fields and strings.

Acceptance criteria:
- No sentinel secret appears in captured logs at any nesting level.
- Ordinary error name, safe message, and request ID remain useful.
- Health/API error response remains generic.

Verification:
Run log redaction tests and health/API handler tests.

## Phase 7 — Performance

لا يوجد optimization مؤكد يحتاج تنفيذاً قبل قياسه. بعد TODO-006/007، سجّل Lighthouse أو trace baseline لصفحات dashboard/floor/customers ثم أنشئ مهام فقط للمشكلات المقاسة. Pagination العملاء موصوفة في TODO-004 كوظيفة وصول للبيانات.

## Phase 8 — Code Cleanup

### TODO-011
Title: Resolve unused payment-list helper

Priority:
LOW

Files:
- `Code/src/modules/finance/checkout.ts`

Problem:
`listPaymentsForCharge` is an unused function and the only current ESLint warning.

Current behavior:
Lint exits successfully but reports the function as unused.

Expected behavior:
No unused helper remains unless it has an explicit tested caller.

Implementation requirements:
- Confirm no indirect/dynamic caller exists.
- Remove the helper or use it in the intended checkout read model with focused coverage.

Acceptance criteria:
- `npm run lint` has zero warnings from this helper.
- Existing checkout/payment response contract remains unchanged.

Verification:
Run checkout tests and `npm run lint`.

## Phase 9 — Architecture Improvements

### TODO-012
Title: Reconcile implementation checkpoint with verified state

Priority:
LOW

Files:
- `Code/docs/architecture/IMPLEMENTATION_STATUS.md`
- Depends on: TODO-001, TODO-002, TODO-003, TODO-007, TODO-008

Problem:
The checkpoint says browser verification is pending and lists milestone work as in progress; the full suite currently has failures and no authenticated browser smoke result.

Current behavior:
The checkpoint does not capture this audit’s failing build/tests and the local auth database’s inability to support admin smoke.

Expected behavior:
Status accurately states what is verified, what remains pending, and whether pilot conditions changed.

Implementation requirements:
- Update the checkpoint only after fixes/tests are actually completed.
- Preserve explicit hosted migration authorization boundaries and NEEDS DECISION entries.

Acceptance criteria:
- Each status claim links to current repo evidence or a verification date/result.
- No milestone is marked closed based only on this audit.

Verification:
Review the status against migration files, tests, deployment docs, and latest browser smoke report.

