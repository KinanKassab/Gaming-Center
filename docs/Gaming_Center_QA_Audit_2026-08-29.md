# Gaming Center SaaS — Localhost QA Audit & AI Handoff

**Audit date:** 2026-08-29  
**Project:** Gaming Center SaaS  
**Repository:** `E:\AKODUS\01-Products\Gaming-Cards`  
**Application:** `E:\AKODUS\01-Products\Gaming-Cards\Code`  
**Local URL:** `http://localhost:3000`  
**Overall QA verdict:** **NOT READY FOR RELEASE**  
**Confirmed bugs:** Critical **0** · High **6** · Medium **14** · Low **6**  
**Automated baseline:** `npm test` → **51 files / 339 tests passed**  
**Status:** Persistent QA handoff. Read this before continuing fixes or retesting.

---

# 1. Purpose

This document preserves the complete localhost QA audit so another AI agent or a future conversation can continue without losing project/testing context.

It contains the environment, discovered routes/features, browser/tool coverage, all confirmed bugs, billing/payment integrity findings, auth/permissions findings, responsive/accessibility/performance findings, tested journeys, untested areas, local QA data, quality scores, recommended fix order, and regression checklist.

> **Continuation rule:** Do not assume any bug here is fixed unless a later dated QA/fix report explicitly marks it fixed with regression evidence. The **current local filesystem/working tree** is the source of truth; GitHub may be older.

> **Later dated update (do not treat the counts above as current):** see Fix Batches 1–3E and [Fix Batch 4 — BUG-014 / BUG-015 / BUG-016 / BUG-020](#fix-batch-4--bug-014--bug-015--bug-016--bug-020) (2026-08-30). Original findings in sections 1–25 remain historical evidence and were not rewritten.

> **Later dated update (2026-08-31):** [Fresh Full Regression Audit](#fresh-full-regression-audit--2026-08-31) recorded BUG-030–036 (High 2). [Fresh Regression Fix P0 — BUG-033 / BUG-036](#fresh-regression-fix-p0--bug-033--bug-036) closed those two High findings. [Fresh Regression Fix P1 — BUG-030 / BUG-031 / BUG-032](#fresh-regression-fix-p1--bug-030--bug-031--bug-032) closed the remaining Fresh Medium chrome/hydration/login-error findings. [Fresh Regression Fix P2 — BUG-034 / BUG-035](#fresh-regression-fix-p2--bug-034--bug-035) closed the remaining Fresh Medium/Low items. Remaining Fresh items: **none**. Do not treat the counts in §2 as current.

---

# 2. Executive Summary

The application is **NOT READY FOR RELEASE**.

Core single-device Gaming Floor → Session → Billing → Checkout behavior works for a guest session, including Start, Pause, Resume, End, PRORATED_HOUR billing at 100 SYP/hour, non-billable pause exclusion, a 5-minute positive-session minimum for a single segment, CASH checkout, manual ShamCash recording, and customer partial settlement.

Release is blocked by six confirmed High issues:

1. **Logout does not invalidate the Better Auth session.**
2. **A moved short session is charged the 5-minute minimum once per segment, causing overbilling.**
3. **Mobile/tablet management drawer does not become visible.**
4. **Arabic RTL puts the desktop sidebar on the left.**
5. **Guided Setup bulk device creation may send an empty `deviceTypeId` on first submit.**
6. **Several core admin modules remain hard-coded in English while Arabic is the default locale.**

There are also 14 Medium and 6 Low issues covering post-End checkout UX, Guided Setup completion behavior, i18n gaps, FieldHelp clipping, mobile overlap, report timezone semantics, accessibility labels, and polish.

---

# 3. Environment

## Runtime

- Framework: **Next.js App Router**
- Next.js version observed: **15.5.23**
- Local server: `npm run dev`
- URL: `http://localhost:3000`
- `GET /api/health/live` → `200`, `ok`
- `GET /api/health/ready` → `200`, `ok`

## Database

Mutating browser tests ran against local PostgreSQL:

- Host: `127.0.0.1`
- Database: `gaming_center_security_test`

The repository also contains a hosted Supabase URL in `.env`, but it was **not used** during this QA run. Secrets were not printed.

## Working tree

- Local repository contains an uncommitted **UX / Product Consolidation Pass**.
- Local filesystem is the source of truth.
- Milestones 1–8 are closed in the checkpoint.
- Milestone 9 / POS has **not started**.

---

# 4. Testing Tools / Automated Baseline

## Browser tools used

- **Cursor Browser** — public/unauthenticated surfaces.
- **Playwright MCP** — authenticated journeys and browser interactions.
- DOM/CSS evaluation — responsive/sidebar geometry.

## Available but not fully used

- **Chrome DevTools MCP** was available.
- No full Performance profile was completed.

## Playwright package

- Playwright is not in `package.json`.
- It was not installed.

## Existing tests actually run

```text
npm test
```

Result:

```text
51 files
339 tests passed
~15.5 minutes
```

Not run in this QA audit:

```text
npm run typecheck
npm run lint
npm run build
npm run test:postgres
npm run test:supabase
```

`test:supabase` must not be run without explicit authorization because it is destructive to hosted state.

---

# 5. Routes / Product Areas Discovered

## Public / Auth

- `/`
- `/login`
- `/setup`

## Admin / Product

- `/admin`
- `/admin/onboarding`
- `/admin/branches`
- `/admin/gaming`
- `/admin/gaming/areas`
- `/admin/gaming/areas/[areaId]`
- `/admin/gaming/device-types`
- `/admin/gaming/device-types/[deviceTypeId]`
- `/admin/gaming/devices`
- `/admin/gaming/devices/[deviceId]`
- `/admin/gaming/pricing`
- `/admin/gaming/floor`
- `/admin/gaming/sessions`
- `/admin/gaming/sessions/[sessionId]`
- `/admin/gaming/sessions/[sessionId]/checkout`
- `/admin/customers`
- `/admin/customers/[customerId]`
- `/admin/users`
- `/admin/roles`
- `/admin/reports`
- `/admin/audit`
- `/admin/settings`

No upload feature was discovered.

---

# 6. Observed Current Capabilities

- Better Auth login/session.
- Protected admin routes.
- First-owner setup closure after an owner exists.
- Public signup closed.
- Organizations / Branches / Areas.
- Device Types / Devices / Bulk Device Creation.
- Pricing Plans / Assignments.
- PRORATED_HOUR billing.
- Gaming Floor.
- Session Start / Pause / Resume / Move / End.
- Session Billing.
- CASH payments.
- Manual ShamCash payments.
- Customers and partial customer settlement.
- Staff / Roles / permissions.
- Reports.
- Audit / activity.
- Settings.
- Arabic / English.
- RTL / LTR.
- Light / Dark theme.
- Guided Setup / Onboarding.

---

# 7. Confirmed Bug Index

| ID | Severity | Title |
|---|---|---|
| BUG-001 | High | Mobile/tablet sidebar never becomes visible |
| BUG-002 | High | Arabic RTL sidebar sits on the left at desktop |
| BUG-003 | High | Guided Setup bulk devices posts empty `deviceTypeId` |
| BUG-004 | High | Sign out does not end the session |
| BUG-005 | High | 5-minute minimum applied per segment after device move |
| BUG-006 | High | Arabic locale not applied to several admin modules |
| BUG-007 | Medium | Ending session leaves operator on Floor with no checkout path |
| BUG-008 | Medium | Dashboard wizard overlay disappears once operationally ready |
| BUG-009 | Medium | Server validation errors shown as raw English |
| BUG-010 | Medium | Bill durations are English on Arabic pages |
| BUG-011 | Medium | Payment method labels are English codes |
| BUG-012 | Medium | Audit/activity missing or mismatched action keys |
| BUG-013 | Medium | Completed session header device is an em dash |
| BUG-014 | Medium | FieldHelp panel clipped in RTL |
| BUG-015 | Medium | Occupied floor tiles oversized; cancel always visible |
| BUG-016 | Medium | Mobile topbar wraps; primary floor action under bottom nav |
| BUG-017 | Medium | Wizard Next can advance without saving current step |
| BUG-018 | Medium | Reports date range is UTC while org timezone is local |
| BUG-019 | Medium | Settings expose default time unit as seconds |
| BUG-020 | Medium | Duplicate accessible names on money/customer fields |
| BUG-021 | Low | `favicon.ico` 404 |
| BUG-022 | Low | Public login has no language switcher |
| BUG-023 | Low | Guest full-pay notice remains after bill is PAID |
| BUG-024 | Low | Back links use physical left arrow in RTL |
| BUG-025 | Low | Organization name field marked optional |
| BUG-026 | Low | End confirm is inline alertdialog without overlay trap |

---

# 8. Full Bug Reports

## BUG-001 — Mobile/tablet sidebar never becomes visible

**Severity:** High  
**Category:** Responsive  
**Location:** Admin shell; hamburger / More; all `/admin/*`  
**Environment:** Playwright, `390×844`, English Dark; also reproduced in Arabic  
**Preconditions:** Authenticated admin

### Steps to reproduce

1. Resize to `390×844` or tablet range `721–1100`.
2. Click **Open menu** / hamburger or bottom-nav **More**.
3. Observe the overlay and sidebar.

### Expected behavior

Sidebar drawer becomes visible and management links are reachable.

### Actual behavior

`.app-sidebar.open` remains `display:none`, width/height `0`. Backdrop covers the page but navigation links are not shown.

### Evidence

```text
className: "app-sidebar open"
display: "none"
```

The direction-scoped sidebar hide selectors have greater specificity than `.app-sidebar.open`.

### Likely cause

Responsive hide rule overrides the open state.

### Suggested fix

Use equal/higher specificity for the open state or restructure responsive state styling.

---

## BUG-002 — Arabic RTL sidebar sits on the left at desktop width

**Severity:** High  
**Category:** UI / i18n  
**Location:** Admin shell at `1440×900`, `dir=rtl`  
**Environment:** Arabic Light

### Steps to reproduce

1. Set locale to Arabic.
2. Open `/admin` or Settings at `1440×900`.
3. Observe/measure sidebar position.

### Expected behavior

Sidebar physically on the **right**.

### Actual behavior

Sidebar physically on the **left**.

Observed geometry:

```text
grid: 1161px 264px
sidebar x=0 width=264
main x=264
```

### Likely cause

Double compensation between CSS Grid placement and `direction: rtl`.

### Suggested fix

Use one direction strategy only: either swap tracks explicitly or rely on logical direction, but not both.

---

## BUG-003 — Guided Setup bulk devices posts empty `deviceTypeId`

**Severity:** High  
**Category:** Functional  
**Location:** Guided Setup → Devices → `POST /api/gaming/devices/bulk`  
**Environment:** Arabic first-run wizard

### Steps to reproduce

1. Create a device type in the wizard.
2. Advance to Devices.
3. Submit bulk create without re-selecting the visible type.

### Expected behavior

Visible type is submitted; request returns `201`.

### Actual behavior

First request returns `400` with:

```text
deviceTypeId: ""
```

UI still visually shows the newly created Device Type. Manually re-selecting it then returns `201`.

### Evidence

```text
POST /api/gaming/devices/bulk → 400
POST /api/gaming/devices/bulk → 201 after reselect
```

### Likely cause

Selected type state is initialized before refreshed deviceTypes are available and not synchronized afterward.

### Suggested fix

Synchronize selected type when deviceTypes updates; disable submit until a real ID exists.

---

## BUG-004 — Sign out does not end the session

**Severity:** High  
**Category:** Security  
**Location:** Topbar Sign out → `POST /api/auth/sign-out`  
**Environment:** English Dark  
**Preconditions:** Authenticated owner

### Steps to reproduce

1. Sign in.
2. Click **Sign out**.
3. Inspect Network.
4. Open `/login`.

### Expected behavior

Better Auth session is invalidated; `/login` remains visible; protected `/admin` requires authentication.

### Actual behavior

```text
POST /api/auth/sign-out → 415
```

Organization context cookie is cleared, but Better Auth session remains valid. `/login` redirects back to `/admin` because authentication persists.

### Likely cause

Sign-out request does not satisfy the installed Better Auth endpoint contract (likely missing expected JSON/content type).

### Suggested fix

Use the canonical Better Auth sign-out contract for the installed version. Only clear organization context after successful auth sign-out and surface failure on 4xx.

---

## BUG-005 — 5-minute minimum applied per segment after device move

**Severity:** High  
**Category:** Functional / Billing Integrity  
**Location:** Session Bill after MOVE  
**Observed session:** `/admin/gaming/sessions/01a04e0b-08db-7c90-0744-1f4648cecd94`  
**Environment:** Arabic, PRORATED_HOUR, `100 SYP/hour`

### Steps to reproduce

1. Start a customer session on Device A.
2. Move quickly to Device B.
3. End while total play is under 5 minutes.
4. Open Bill.

### Expected behavior

Positive-session minimum is **5 billable minutes once per session**. At `100/hour`, total should be `10 SYP`.

### Actual behavior

```text
Segment 1: 12 sec → 5 min → 10 SYP
Segment 2: 21 sec → 5 min → 10 SYP
Total: 20 SYP
```

### Evidence

Session detail bill and checkout. Source behavior indicates `roundBillableSecondsProrated` is applied per segment.

### Likely cause

Positive minimum implemented at segment level instead of canonical session level.

### Suggested fix

Calculate PRORATED_HOUR customer-facing charge from canonical session billable duration once. Preserve segment history without multiplying minimum charges because of MOVE.

---

## BUG-006 — Arabic locale not applied to several admin modules

**Severity:** High  
**Category:** UI / i18n  
**Location:** Multiple admin routes  
**Environment:** Arabic selected

### Affected examples

- `/admin/customers`
- `/admin/reports`
- `/admin/users`
- `/admin/roles`
- `/admin/audit`
- Device filters
- `/admin/gaming` hub

### Expected behavior

Arabic UI when Arabic is selected/default.

### Actual behavior

Navigation/chrome may be Arabic while main content stays English, including `Customers`, `Reports`, `Staff`, `Roles`, `Activity`, `Branch`, `Filter`, `Add one device`.

### Likely cause

Pages hard-code English rather than using the current i18n helpers/dictionaries.

### Suggested fix

Wire all user-facing strings to request locale + `t()` consistently.

---

## BUG-007 — Ending a session leaves operator on Floor with no checkout path

**Severity:** Medium  
**Category:** UX  
**Location:** Gaming Floor → End session

**Expected:** Clear route/action to Bill/Checkout after End.  
**Actual:** Floor refreshes; device becomes available; no toast or checkout link. Operator must find the session manually.  
**Suggested fix:** Route to session detail/checkout or provide an explicit checkout CTA.

---

## BUG-008 — Dashboard wizard overlay disappears once operationally ready

**Severity:** Medium  
**Category:** UX  
**Location:** Dashboard Guided Setup

**Expected:** First-run flow continues through Payments / Staff / Finish or explicit completion/dismiss.  
**Actual:** After pricing assignment, dashboard overlay disappears when operational readiness becomes true, while `/admin/onboarding` still contains later steps.  
**Suggested fix:** Separate operational readiness from wizard completion/dismissal.

---

## BUG-009 — Server validation errors shown as raw English

**Severity:** Medium  
**Category:** i18n / UX  
**Location:** Checkout, Bulk Devices, other forms

Arabic UI exposes messages such as:

```text
Guest sessions must be paid in full
Payment amount must be greater than zero
Payment exceeds remaining amount due
Invalid input
```

**Suggested fix:** Map known API/domain error codes to localized UI strings; do not render raw English server messages.

---

## BUG-010 — Bill durations are English on Arabic pages

**Severity:** Medium  
**Category:** i18n  
**Location:** Session detail / Bill

Examples:

```text
2 minutes 58 seconds
5 minutes
12 seconds
```

**Likely cause:** English-only duration formatter.  
**Suggested fix:** Locale-aware duration formatting.

---

## BUG-011 — Payment method labels are English codes

**Severity:** Medium  
**Category:** i18n  
**Location:** Checkout method select and payment history

Actual labels include `Cash` and `ShamCash`.  
**Suggested fix:** Keep stored internal codes, render localized labels.

---

## BUG-012 — Audit/activity missing or mismatched action keys

**Severity:** Medium  
**Category:** i18n  
**Location:** `/admin/audit`, Dashboard recent activity

Observed mixed/fallback actions:

```text
gaming session ended
core customer created
core organization created
core branch access granted
gaming device updated
```

**Likely cause:** Stored audit action strings and dictionary keys do not fully align; locale not consistently passed.  
**Suggested fix:** Normalize audit action keys and centralize localized display mapping.

---

## BUG-013 — Completed session header device is an em dash

**Severity:** Medium  
**Category:** UX  
**Location:** Completed Session detail

Header shows `الجهاز: —` while segment table shows the station.  
**Likely cause:** `currentDeviceId` is cleared on completion and header only reads current device.  
**Suggested fix:** For completed sessions show last segment/device or a historical device summary.

---

## BUG-014 — FieldHelp panel clipped in RTL

**Severity:** Medium  
**Category:** UI  
**Location:** Settings FieldHelp, Arabic RTL

Panel opens from the correct info control but is clipped at the left edge.  
**Suggested fix:** Direction-aware positioning/collision handling and safe overflow behavior.

---

## BUG-015 — Occupied Floor tiles oversized; cancel always visible

**Severity:** Medium  
**Category:** UX  
**Location:** Gaming Floor occupied device card

Occupied cards include Pause/End/Move plus an always-visible Cancel textarea. They become ~600px tall and vacant tiles stretch with the grid.  
**Suggested fix:** Keep primary actions visible; move Cancel behind a secondary/destructive flow; prevent equal-height stretching.

---

## BUG-016 — Mobile topbar wraps; primary Floor action sits under bottom nav

**Severity:** Medium  
**Category:** Responsive  
**Location:** `390×844` Floor / Checkout

Observed:

- Language + Theme + Sign out wrap into ~164px header.
- Start can sit behind fixed bottom nav.
- Checkout payment table overflows horizontally.

**Suggested fix:** Compact mobile header controls, pad content above bottom nav, and use mobile card/stacked table patterns.

---

## BUG-017 — Wizard Next can advance without saving current step

**Severity:** Medium  
**Category:** UX  
**Location:** Guided Setup

Next can increment step index without required current-step data being saved.  
**Suggested fix:** Disable Next until requirements are satisfied, or make Next perform/save the step.

---

## BUG-018 — Reports date range is UTC while organization timezone is local

**Severity:** Medium  
**Category:** UX  
**Location:** `/admin/reports`

Copy shows `From (UTC)` / `Day (UTC)` while org timezone was `Asia/Riyadh`. Dashboard "billed today" used local business day.  
**Suggested fix:** Use org timezone consistently for business reporting.

---

## BUG-019 — Settings expose default time unit as 60 seconds

**Severity:** Medium  
**Category:** UX  
**Location:** Settings

Low-level billing/time unit is exposed as `60 seconds`.  
**Suggested fix:** Hide for PRORATED_HOUR owners or present as a human duration control.

---

## BUG-020 — Duplicate accessible names on money/customer fields

**Severity:** Medium  
**Category:** Accessibility  
**Location:** Checkout amount; Floor customer selector; Staff email

Examples include repeated accessible label text such as `Email Email`.  
**Suggested fix:** One label relationship per control; avoid duplicate aria text.

---

## BUG-021 — `favicon.ico` returns 404

**Severity:** Low  
**Category:** API / Asset

```text
GET /favicon.ico → 404
```

**Suggested fix:** Add valid metadata icon or remove invalid reference.

---

## BUG-022 — Public login has no language switcher

**Severity:** Low  
**Category:** UX  
**Location:** `/login`

Default Arabic is used; current locale POST is authenticated, so English cannot be selected before login.  
**Suggested fix:** Allow presentation-only locale choice on public auth surfaces.

---

## BUG-023 — Guest full-pay notice remains after bill is PAID

**Severity:** Low  
**Category:** UX  
**Location:** Checkout after full settlement

Guest full-payment notice remains even at remaining balance `0`.  
**Suggested fix:** Hide after settlement or replace with paid confirmation.

---

## BUG-024 — Back links use physical left arrow in RTL

**Severity:** Low  
**Category:** UI  
**Location:** Device/customer detail

Examples: `← Devices`, `← Customers` under Arabic RTL.  
**Suggested fix:** Use logical/directional back icons.

---

## BUG-025 — Organization name field marked optional

**Severity:** Low  
**Category:** UX  
**Location:** Dashboard Business Profile

Organization Name shows an `optional` indicator despite being conceptually required for the business.  
**Suggested fix:** Correct optional/required metadata.

---

## BUG-026 — End confirm is inline alertdialog without overlay trap

**Severity:** Low  
**Category:** Accessibility  
**Location:** Gaming Floor → End

End confirmation is rendered inline inside the device card and does not provide shared overlay/focus-trap behavior. Earlier Guided Setup checks also found incomplete Escape behavior.  
**Suggested fix:** Use the shared accessible confirmation overlay/dialog.

---

# 9. UI / UX Findings

- Large dotted/network canvas occupies too much visual space relative to compact operational content on Dashboard/Floor/Settings.
- Floor Cancel textarea competes with Pause/End — see BUG-015.
- `/admin/gaming` remains English (`Floor setup`) while Arabic nav is active.
- Pricing Assignment still exposes technical English such as `Advanced` / `Priority`.
- ShamCash hint **PASS**: staff-recorded/manual, not falsely presented as a live provider API.
- Reports correctly separate **Play billed** vs **Payments recorded**.
- Device-usage reporting warns that moves can double-count; operators may still misread this, especially around BUG-005.

---

# 10. Responsive Findings

## Mobile — `390×844`

- Bottom nav Home / Floor / Sessions / Customers works.
- More opens the same broken invisible drawer — BUG-001.
- Topbar wraps heavily — BUG-016.
- Floor Start may be hidden beneath bottom nav — BUG-016.
- Checkout payment table overflows — BUG-016.

## Tablet — `900×900`

Not fully tested because Playwright viewport remained stuck at 390 after resize. The tablet CSS uses the same sidebar hide rules implicated by BUG-001, so the bug is likely but not independently confirmed.

## Desktop — `1440×900`

- Arabic RTL sidebar on wrong side — BUG-002.
- English LTR sidebar left — PASS.

## Laptop `1366×768`

NOT TESTED.

## Wide Desktop `1920×1080`

NOT TESTED.

---

# 11. Accessibility Findings

## Passed

- Skip link exists (`تخطَّ إلى المحتوى` / `Skip to content`).
- FieldHelp trigger is the info control only.
- FieldHelp can close with Escape.
- Dark Floor was generally readable.

## Issues

- FieldHelp clipping in RTL — BUG-014.
- Duplicate accessible labels — BUG-020.
- End confirmation lacks proper shared overlay/focus handling — BUG-026.
- Full keyboard-only navigation not completed.
- Formal WCAG contrast measurement not completed.
- Mobile Start action may be obscured — BUG-016.
- Mobile management navigation unavailable — BUG-001.

---

# 12. Performance Findings

No formal production performance audit was completed.

Observed:

- No obvious request loop on Gaming Floor.
- Dev Fast Refresh around `1.6–3.3s` during session (development-only, not a production metric).
- No measured TTI/LCP/CLS.
- No full Chrome DevTools Performance profile.
- No Lighthouse.

Performance score therefore has lower confidence than functional/billing results.

---

# 13. Console / Network Findings

| Trigger | Request | Status | Result |
|---|---|---:|---|
| Sign out | `POST /api/auth/sign-out` | 415 | BUG-004; session remains |
| Guest partial payment | `POST .../payments` | 409 | Expected rejection; English message |
| Zero payment | `POST .../payments` | 400 | Expected rejection; English message |
| Overpayment | `POST .../payments` | 409 | Expected rejection |
| Bulk devices first submit | `POST /api/gaming/devices/bulk` | 400 | BUG-003 |
| Session start/pause/resume/end/move | session APIs | 200/201 | PASS |
| CASH/ShamCash payment | payments | 201 | PASS |
| Double-click payment | payments | one 201 | PASS |
| Unauthenticated protected APIs | various | 401 | PASS |
| Signup without token | signup | 403 | PASS |
| `GET /api/organizations` | organizations | 405 | POST-only; not a leak |
| favicon | `/favicon.ico` | 404 | BUG-021 |

No app-attributed React hydration error was confirmed during authenticated Playwright flow.

---

# 14. Authentication / Authorization Results

| Check | Result |
|---|---|
| Unauthenticated `/admin` | PASS → login |
| Unauthenticated nested admin | PASS |
| Empty/invalid/wrong-password login validation | PASS in earlier run |
| Session persistence after refresh | PASS |
| Authenticated `/` → `/admin` | PASS |
| Authenticated `/login` → `/admin` | PASS |
| Existing-owner `/setup` | PASS closed |
| Public signup | PASS 403 |
| Logout | **FAIL — BUG-004** |
| Back after logout | NOT TESTED because logout failed |
| Organization selection/create | PASS |
| Second tenant | NOT TESTED |
| Restricted/branch-limited staff | NOT TESTED |
| Server authorization as weak role | NOT TESTED |

## Permission examples observed in source

```text
core.organizations.read/manage
core.branches.read/manage
core.memberships.read/manage
core.roles.read/manage
core.settings.read/manage
core.customers.read/manage
core.audit.read
gaming.master.read/manage
gaming.sessions.read/start/operate/cancel
finance.payments.read/create
```

Branch access levels observed:

```text
VIEW
OPERATE
MANAGE
```

Owner is built-in with full permissions.

---

# 15. Billing / Payment Integrity Results

## Approved PRORATED_HOUR concepts

- Canonical billable duration.
- Non-billable pause excluded.
- Time rounded to nearest 5 minutes.
- Positive session minimum 5 minutes.
- Exact zero remains zero.
- Hourly price prorated.
- Final amount rounded to nearest 5 currency units.
- Bigint/integer arithmetic.
- Historical finalized bills immutable.

## Live results

| Topic | Result |
|---|---|
| 100/hour, ~3 min + 25s non-billable pause | PASS |
| Play duration | 2m 58s |
| Billable | 5 min |
| Amount | 10 SYP |
| Pause excluded | PASS |
| Positive min 5 min for single segment | PASS |
| Positive min across MOVE segments | **FAIL — BUG-005** |
| Minor units hidden | PASS |
| Finalized bill auto-created on End | PASS |
| Full 5–120 min table | Unit tests only |
| 120/hour examples | Unit tests only |
| Guest full-pay rule | PASS |
| Customer partial payment | PASS |
| CASH | PASS |
| Manual ShamCash | PASS |
| Overpayment | PASS rejected |
| Zero payment | PASS rejected |
| Double-click payment | PASS single 201 |

## Critical MOVE observation

Session #2:

```text
Segment 1: 12 sec → 5 min → 10 SYP
Segment 2: 21 sec → 5 min → 10 SYP
Total: 20 SYP
```

The approved business rule is a **session-wide** positive minimum, not a per-MOVE-segment minimum.

---

# 16. Tested User Flows

## Flow 1 — Public/Auth

Unauthenticated home/login/theme: **PARTIAL/PASS**.

## Flow 2 — First organization + Guided Setup

```text
Create QA Gaming Center
→ Branch
→ Area
→ Device Type
→ Bulk Devices
→ Pricing 100
→ Assignment
```

Result: **PARTIAL** because of BUG-003 and BUG-008.

## Flow 3 — Guest session

```text
Floor
→ Guest Start
→ Pause
→ Resume
→ End
→ Bill 10 SYP
→ Invalid payment tests
→ CASH 10
```

Result: **PASS**, with UX issue BUG-007.

## Flow 4 — Customer session + MOVE

```text
Create QA Customer
→ Start customer session
→ Move 01 → 02
→ End
→ Bill 20
→ Partial CASH 10
→ ShamCash 10
```

Result: **PARTIAL / FAIL billing expectation** due to BUG-005.

## Flow 5 — Maintenance

```text
Device detail
→ Maintenance
→ Floor
```

Result: **PASS**. Maintenance device did not expose Start.

## Flow 6 — Admin modules

Visited Customers / Reports / Staff / Roles / Audit / Settings / Onboarding.  
Result: **PARTIAL** due to BUG-006 and related i18n issues.

## Flow 7 — Mobile navigation

`390×844` → **FAIL — BUG-001**.

## Flow 8 — Sign out

**FAIL — BUG-004**.

## Flow 9 — Malformed session ID

**PASS** with Arabic not-found message:

```text
الجلسة غير موجودة.
```

---

# 17. Areas Not Fully Tested

- Second organization / cross-tenant isolation through browser.
- Cashier / branch-limited / read-only accounts.
- Direct URL/API attempts as restricted roles.
- Additional staff creation.
- Custom role submission.
- Suspending owner.
- Package pricing.
- Legacy UNIT pricing.
- 120/hour live pricing.
- Full live 5–120 minute duration table.
- Cancel session.
- Guest-disabled mode.
- Slow/offline network simulation.
- Full AR Dark matrix.
- Full EN Light matrix.
- System theme.
- `360×800`.
- `900×900` after viewport issue.
- `1366×768`.
- `1920×1080`.
- Full keyboard-only pass.
- Screen-reader pass.
- Formal WCAG contrast measurement.
- Chrome DevTools Performance trace.
- Lighthouse.
- `npm run typecheck`.
- `npm run lint`.
- `npm run build`.
- `npm run test:postgres`.
- Hosted Supabase testing.
- POS / inventory modules (M9 not started).

---

# 18. Existing Automated Test Baseline

Executed:

```text
npm test
```

Result:

```text
51 test files
339 tests passed
~930 seconds
```

Coverage includes billing prorated tables (100/hour and 120/hour), tenant isolation, sessions, checkout, i18n/theme, bulk devices, and onboarding status.

Passing automated tests did **not** catch BUG-001, BUG-002, BUG-004, BUG-006, or live BUG-005.

---

# 19. QA Test Data Left in Local Database

Prefix used: `QA`

- Organization: `QA Gaming Center`
  - Currency: SYP
  - Locale: Arabic
  - Timezone: `Asia/Riyadh`
- Branch: `QA Branch`
- Area: `QA Area`
- Device Type: `QA Device Type`
- `QA Station - 01` — final tested state Maintenance
- `QA Station - 02`
- Pricing Plan: `QA Hourly 100`
- Customer: `QA Customer`
- Phone: `+963991000001`
- Session #1 — Guest, PAID, CASH 10
- Session #2 — Customer, PAID, CASH 10 + ShamCash 10
- ShamCash reference: `QA-SC-001`

Test data was not deleted. Do not use raw SQL cleanup unless explicitly authorized.

---

# 20. Final Quality Scores

| Category | Score | Reason |
|---|---:|---|
| Functionality | 6/10 | Core Floor/Checkout works; logout, bulk first submit, MOVE billing broken |
| UI | 6/10 | Design tokens/chrome decent; RTL sidebar and mixed English remain |
| UX | 5/10 | End→Checkout path, wizard flow, Floor density need work |
| Responsive Design | 3/10 | Management nav broken on phone; bottom-nav overlap |
| Accessibility | 5/10 | Skip link/FieldHelp exist; focus/labels/confirm/mobile issues remain |
| Performance | 7/10 | No major measured slowdown; no formal production audit |
| Stability | 6/10 | No crash; logout 415 and bulk 400 are real runtime defects |
| i18n completeness | 4/10 | Arabic is default but several core modules remain English |

---

# 21. Recommended Fix Order

## P0 — Release Blocking

### P0.1 BUG-004 — Logout session invalidation

Regression target:

```text
login
→ sign out
→ /login remains visible
→ /admin redirects to login
→ refresh remains logged out
→ Back does not restore usable admin
```

### P0.2 BUG-005 — Session-wide PRORATED_HOUR minimum

Regression target:

```text
100/hour
→ start
→ move within <5 min total
→ end
→ total must be 10 SYP, not 20
```

Also retest multi-segment rounding boundaries, pause exclusion, finalized bill stability, and legacy UNIT behavior.

## P1 — High Priority

Recommended order:

1. BUG-001 — Mobile/tablet drawer.
2. BUG-002 — RTL desktop sidebar.
3. BUG-003 — Bulk Device Type initialization.
4. BUG-006 — Arabic adoption across admin modules.

## P2 — Medium Priority

- BUG-007 through BUG-020.

## P3 — Polish / Low

- BUG-021 through BUG-026.

---

# 22. Regression Checklist After Fixes

## Authentication

- Valid login.
- Invalid login rejected.
- Session persists refresh.
- Sign out invalidates auth.
- `/login` remains after sign out.
- `/admin` blocked after sign out.
- Browser Back does not restore usable admin.

## Billing

- 100/hour ~3 min → 10 SYP.
- Pause excluded.
- MOVE under 5 total minutes → 10 SYP, not 20.
- Multi-segment >5 min rounds once at session level.
- Legacy UNIT unchanged.
- Finalized bill immutable.
- Guest full payment.
- Customer partial payment.
- CASH.
- Manual ShamCash.

## Guided Setup

- Device Type create.
- Bulk Devices first submit without manual reselect.
- Multiple devices.
- Pricing/assignment.
- Wizard progress/finish.
- No invalid Next.

## Responsive

### AR `1440×900`
Sidebar physically right.

### EN `1440×900`
Sidebar physically left.

### Mobile `390×844`
Hamburger works; More works; drawer visible; Start not covered; Checkout usable.

### Tablet `900×900`
Drawer works; no unusable desktop sidebar.

## i18n

Arabic coverage for Customers, Reports, Staff, Roles, Audit, Devices, Pricing, validation errors, durations, payment methods.

## Accessibility

Dialog focus trap, Escape, focus restore, single accessible label, FieldHelp RTL collision, touch targets.

## Validation before release

```text
npm run typecheck
npm run lint
npm test
npm run build
```

Do not run `test:supabase` without explicit authorization.

---

# 23. Release Recommendation

## Current recommendation

**NOT READY**

At minimum, release remains blocked until BUG-004 and BUG-005 are fixed and regression-tested, plus BUG-001, BUG-002, BUG-003, and core Arabic coverage BUG-006 are addressed.

---

# 24. AI Continuation Instructions

Any future AI agent continuing from this file should:

1. Read current local repository and `git status` first.
2. Treat the local filesystem as newer than GitHub unless proven otherwise.
3. Do not assume this report reflects the latest code after future fixes.
4. For each authorized bug fix: inspect current code → reproduce when practical → fix only authorized scope → add focused regression tests → browser-retest localhost.
5. Do not reset/discard unrelated uncommitted work.
6. Do not mutate hosted Supabase.
7. Do not run `test:supabase`.
8. Do not commit/push/deploy unless explicitly authorized.
9. Preserve Better Auth, tenant isolation, RLS, `gaming_app`, billing snapshots, finalized-bill immutability, approved PRORATED_HOUR arithmetic, Guided Setup, Arabic-first direction, CASH, and manual ShamCash semantics.
10. After each fix batch, update this QA handoff or create a new dated revision containing fixed bugs, regressions, retest evidence, latest automated test counts, and current release recommendation.

---

# 25. Audit Completion Record

```text
TESTING AUDIT COMPLETE

Critical: 0
High: 6
Medium: 14
Low: 6

Release recommendation: NOT READY
```

---

# Fix Batch 1 — BUG-004 / BUG-005

**Date:** 2026-08-29  
**Scope (authorized only):** BUG-004 logout/session invalidation; BUG-005 PRORATED_HOUR session-wide minimum after MOVE.  
**Not in this batch:** BUG-001, BUG-002, BUG-003, BUG-006, BUG-007–BUG-026. No other bugs were implemented.

Original sections 1–25 above are unchanged historical evidence. This section records the first implementation/regression pass.

**Local HEAD at this batch:** `5fe4e63` (`Add platform bootstrap; gate public signup`) on `master`. Working tree remains dirty (UX/product pass plus this batch). Nothing committed or pushed.

**Better Auth version inspected:** `better-auth` `^1.7.1` in `Code/package.json`. Sign-out HTTP contract: `POST /api/auth/sign-out` with optional JSON body schema; better-call requires `Content-Type: application/json` (HTTP 415 without it).

## BUG-004 — Sign out does not end the session

**Status:** FIXED

### Root cause

Confirmed against current code and HTTP tests (not assumed from the original hypothesis alone).

`SignOutButton` posted `POST /api/auth/sign-out` with no JSON `Content-Type` and no JSON body. Better Auth 1.7 defines sign-out with an optional JSON body schema; better-call therefore returns **HTTP 415** unless `Content-Type: application/json` is sent. The Better Auth session row/cookie stayed valid.

The auth route previously cleared `gc_organization_id` on any sign-out path response, including 415. Clearing org context made logout *look* like it happened while `/login` still redirected an authenticated user to `/admin`.

### Implementation

- Canonical client: `POST`, `credentials: "same-origin"`, `Accept`/`Content-Type: application/json`, body `{}`.
- Organization cookie is cleared **only when** Better Auth returns `ok`.
- UI does **not** navigate away on failed logout; it shows `common.signOutFailed` and the user remains signed in.
- Success uses `window.location.replace("/login")` so Back does not restore the previous admin URL as a usable authenticated page.

### Files changed

- `Code/src/auth/sign-out-http.ts` (new)
- `Code/src/app/admin/_components/controls.tsx` (`SignOutButton`)
- `Code/src/app/api/auth/[...all]/route.ts`
- `Code/src/i18n/messages/en.ts` / `Code/src/i18n/messages/ar.ts` (`common.signOutFailed`)
- `Code/tests/http/sign-out.test.ts` (new)
- `Code/tests/http/route-authorization.test.ts` (canonical JSON sign-out)

### Automated regression evidence

`Code/tests/http/sign-out.test.ts`:

- Empty-body POST → **415**, org cookie **not** cleared, Better Auth session still authenticates.
- Canonical JSON POST → **200** `{ success: true }`, org cookie cleared (`Max-Age=0`), `authenticateRequest` throws `AuthenticationError`, `GET /api/me` → **401**.
- `isSuccessfulSignOutResponse` is false for 415/500.

`route-authorization.test.ts` sign-out case now uses the same canonical init.

### Browser regression evidence

Playwright against `http://localhost:3000` with the existing local QA session (no new first owner; no DB reset).

1. Authenticated admin → **Sign out**.
2. `POST /api/auth/sign-out` → **200** (not 415).
3. Landed on `/login` and remained there.
4. Reload of `/login` stayed on `/login`.
5. Direct navigation to `http://localhost:3000/admin` redirected to `/login`.
6. Browser **Back** (multiple times) stayed on `/login`; admin UI was not restored as a usable authenticated state.

Credentials were not recorded. Browser autofill on the login form was ignored.

### Remaining risk

- Sign-out still depends on Better Auth’s HTTP handler remaining the source of session deletion. Manual `session` table deletes were not added (by design).
- A future Better Auth upgrade that changes the JSON/content-type contract would need the same tests updated.

## BUG-005 — 5-minute minimum applied per segment after MOVE

**Status:** FIXED

### Root cause

Confirmed against current billing code. `roundBillableSecondsProrated` (nearest 5 minutes + positive 5-minute floor) ran **inside each segment line**. MOVE of a short session produced one minimum per closed segment (QA example: 12s + 21s → 10 + 10 = **20 SYP** at 100/hour). Approved product rule: the positive minimum is **once per session**.

### Previous calculation behavior

Per-segment PRORATED_HOUR: each positive segment rounded independently with a 5-minute minimum, then summed. MOVE multiplied the minimum.

### New calculation behavior

1. Sum canonical **session** billable seconds (non-billable pause already excluded in segment timing).
2. Round that session duration to nearest 5 minutes (HALF-UP / away from zero).
3. Apply the 5-minute positive minimum **once** (exact 0 stays 0).
4. Prorate hourly price from the rounded session duration; round money to nearest 5 units once.
5. Allocate rounded duration and money across segments so **segment amounts sum to the session total**. Segment rows remain for device history, timing, audit, and presentation.

MOVE behavior (device change, snapshots, occupancy) was not redesigned. PACKAGE + MOVE still fail-closed. Legacy UNIT CEIL is still per-segment and unchanged (MOVE 60s@100 + 60s@250 = **350**).

On MOVE/END, PRORATED_HOUR no longer persists a per-segment computed amount from `calculateSegmentLine` (that line is timing-only / amount 0 until session finalize). UNIT still writes per-segment amounts. Finalize remains the source of the customer-facing PRORATED total. Re-finalize of an already-finalized bill still refuses overwrite.

### Segment-history behavior

Segment rows are kept (count, device ids, start/end, MOVE end reason). Amounts on those rows after finalize are an allocation of the **session** total, not independent minimums.

### Legacy UNIT impact

Unchanged. Calculator and DB MOVE tests still expect UNIT CEIL sums (e.g. 350). `gaming.billing.v2` is used for PRORATED_HOUR; UNIT keeps the prior rule version.

### Finalized-bill impact

Idempotent re-finalize and “refuse to overwrite a finalized total” tests still pass. The original QA **Session #2** bill of **20 SYP** (two minimums) remains a historical finalized record and was **not** rewritten — that is required immutability, not a remaining product bug.

### Files changed

- `Code/src/modules/gaming/billing-prorated.ts` (`allocateTotalByWeights`, `proratedHourlyAmountFromTerms`)
- `Code/src/modules/gaming/billing-calculator.ts` (`applySessionProratedHourBilling`; PRORATED segment lines are timing-only until session apply)
- `Code/src/modules/gaming/sessions.ts` (`closedSegmentAmount` skips persisting PRORATED per-segment amounts on MOVE/END)
- `Code/src/modules/gaming/index.ts` (export)
- `Code/tests/gaming/billing-prorated.test.ts`
- `Code/tests/gaming/billing.test.ts`

### Automated regression evidence

Calculator (`billing-prorated.test.ts`):

- 12s + 21s (33s) at 100/hour → **10**, two segments, billed duration sums to 300s.
- Three tiny MOVE segments → **10** (not 30).
- Non-billable pause before session-wide minimum.
- 8 minutes across MOVE → 10 minutes → **15**.
- Tiny first + longer second crossing a 5-minute boundary → **15**.
- Mixed hourly rates still one session minimum.
- Legacy UNIT MOVE still **350**.
- Approved 100/hour and 120/hour price tables unchanged.

DB (`billing.test.ts`):

- Fixture MOVE 12s+21s (33s) → total **10**, two segments, stored amounts sum to 10, re-finalize **10**.
- Same-second live MOVE finalizes without conflicting per-segment PRORATED amounts (exact 0 stays 0).
- Plan-edit after finalize does not rewrite PRORATED historical total.
- Finalized overwrite still refused.

### Browser regression evidence

Local QA org, plan **QA Hourly 100**, no raw SQL timestamp edits, no hosted DB.

- `QA Station - 01` was **Ready** for the move (it had been Maintenance in the original QA snapshot).
- New guest/customer session: Start → Move quickly → End while total play **under 5 minutes** → Bill.
- Result: billed as **5 minutes**, **total 10 SYP** (not 20). Two device segments preserved (observed split ~14s / ~20s with allocated 4 + 6 SYP summing to 10).
- Historical QA **Session #2** remained **20 SYP** (finalized before this fix).

Session id observed in this batch: `01a04e46-7757-76aa-cc7c-3b416e980cce` (local QA data; do not treat as production).

### Remaining risk

- Mixed-rate MOVE sessions use one session duration rounding, then money from per-segment hourly rates on allocated seconds. That matches “minimum once per session”; unusual mixed-rate floors were not a live QA path.
- Device-usage reporting that warns about double-counting MOVE still exists (BUG list / UX note); it was not changed in this batch.
- `QA Station - 01` may now be Ready rather than Maintenance from this regression.

## Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **52 files / 353 tests passed** |
| `npm run build` | PASS (Next.js 15.5.23) |

Previous QA baseline was 51 files / 339 tests.

## Latest release recommendation

**NOT READY**

BUG-004 and BUG-005 are no longer release blockers. Remaining High blockers from the original audit:

- BUG-001 — Mobile/tablet sidebar never becomes visible
- BUG-002 — Arabic RTL desktop sidebar on the left
- BUG-003 — Guided Setup bulk device first submit may send empty `deviceTypeId`
- BUG-006 — Several admin modules remain English when Arabic is selected

Medium BUG-007–BUG-020 and Low BUG-021–BUG-026 are unchanged.

```text
FIX BATCH 1 COMPLETE

Critical: 0
High remaining: 4 (BUG-001, BUG-002, BUG-003, BUG-006)
Medium: 14
Low: 6

BUG-004: FIXED
BUG-005: FIXED

Automated: 52 files / 353 tests
Release recommendation: NOT READY
```

---

# Fix Batch 2 — BUG-001 / BUG-002 / BUG-003 / BUG-006

**Date:** 2026-08-29  
**Scope (authorized only):** BUG-001 mobile/tablet drawer visibility; BUG-002 Arabic RTL desktop sidebar side; BUG-003 bulk `deviceTypeId` empty first submit; BUG-006 Arabic page chrome for confirmed admin modules.  
**Not in this batch:** BUG-007–BUG-026. No other bugs were implemented. Fix Batch 1 (BUG-004 / BUG-005) was preserved.

Original sections 1–25 above are unchanged historical evidence. This section records the second implementation/regression pass.

**Local HEAD at this batch:** still `5fe4e63` on `master`. Working tree remains dirty (UX/product pass plus Fix Batch 1 plus this batch). Nothing committed or pushed.

## BUG-001 — Mobile/tablet sidebar never becomes visible

**Status:** FIXED

### Root cause

Confirmed against current CSS before editing. Compact hide used direction-scoped selectors:

```css
.app-shell[data-dir="ltr"] .app-sidebar,
.app-shell[data-dir="rtl"] .app-sidebar { display: none; }
```

Specificity **(0,2,1)** beat `.app-sidebar.open { display: flex }` **(0,2,0)**. Backdrop rendered; the drawer stayed `display: none`.

### Implementation

Single compact drawer for phone and tablet. Hide rule is now `.app-sidebar { display: none }` inside `@media (max-width: 1100px)` only, so `.app-sidebar.open` wins. Drawer uses `position: fixed` and `inset-inline-start: 0` (logical start edge). Bottom nav remains `@media (max-width: 720px)`. Escape, close, backdrop, body scroll lock, and focus restore live in `AdminShell`. Backdrop is not in the DOM when closed.

### Files changed

- `Code/src/ui/shell-layout.ts` (new)
- `Code/src/app/globals.css`
- `Code/src/app/admin/_components/admin-shell.tsx`
- `Code/tests/ui/shell-layout.test.ts` (new)

### Automated tests

`shell-layout.test.ts`: compact breakpoints (390/900 vs 1440), bottom nav only ≤720px, `.app-sidebar.open` uses `display: flex`, no direction-scoped hide selectors, drawer `inset-inline-start: 0`.

### Browser regression

Playwright against `http://localhost:3000` with the existing local Owner (no new first owner). Client JS recovered after restarting `next dev` (previous overlapping `next build` had served 404 chunks).

| Viewport | Locale | Closed | Open | Close |
|---|---|---|---|---|
| 390×844 | AR | sidebar `display:none`; bottom nav visible; hamburger visible | hamburger/More → `display:flex`, x≈70 w=320 (right), 16 links, backdrop, close focused, no overflow | Escape, backdrop, close button; no leftover overlay |
| 900×900 | AR | sidebar hidden; **no** bottom nav; hamburger visible | `display:flex`, x≈580 w=320 (right), 16 links, backdrop | Escape; no leftover overlay |
| 390×844 | EN | bottom nav visible | drawer x=0 w=320 (left), 16 links, backdrop | Escape |
| 900×900 | EN | **no** bottom nav | drawer x=0 w=320 (left), 16 links, backdrop | Escape |

### Remaining risk

- Next.js **dev overlay** (`nextjs-portal`) can intercept pointer events during local `next dev`; product clicks still work when the overlay is dismissed. Production build does not include that overlay.
- Drawer width is `min(20rem, 88vw)`; very small widths were not separately tested below 390.

## BUG-002 — Arabic RTL desktop sidebar on the left

**Status:** FIXED

### Root cause

Confirmed double compensation: `html[dir=rtl]` already reverses CSS grid **and** RTL rules swapped `grid-template-columns` **and** `grid-column: 2`, placing the Arabic sidebar physically left.

### Implementation

One direction strategy: document `dir` on `<html>` only. Grid is always `sidebar track, then workspace`. Do not swap columns or `grid-column` by `data-dir`. `data-dir` remains on the shell for tests/semantics, not for placement. Logical inline properties follow `dir` for the compact drawer.

### Files changed

Same shell/CSS/layout files as BUG-001.

### Automated tests

`desktopSidebarPhysicalSide("rtl")` → `"right"`; `"ltr"` → `"left"`. CSS asserts the grid is `var(--sidebar-w) minmax(0, 1fr)` and does **not** contain the reversed-track rule.

### Browser regression (1440×900)

| Locale | Sidebar | Workspace | Pages |
|---|---|---|---|
| AR `dir=rtl` | x≈1161–1176, w=264, **physical RIGHT** | x=0, no overlap, no horizontal overflow | `/admin`, `/admin/settings`, `/admin/gaming/floor`, `/admin/customers` |
| EN `dir=ltr` | x=0, w=264, **physical LEFT** | x=264, no overlap | same four routes |

Floor’s 1176 vs 1161 track width is scrollbar/viewport, not a left/right placement error. Topbar sits in the workspace column (not over the sidebar).

### Remaining risk

- Directional icons elsewhere (BUG-024 physical `←` back links) were not changed; they are out of this batch.

## BUG-003 — Guided Setup bulk `deviceTypeId` empty on first submit

**Status:** FIXED

### Root cause

`BulkDeviceCreateForm` initialized `deviceTypeId` with `useState(props.deviceTypes[0]?.id ?? "")` and never synced when props refreshed. Wizard: create Device Type → `router.refresh()` not awaited → form can mount with `[]` then receive types. Controlled `<select value="">` still **shows** the first option. First POST sent `deviceTypeId: ""` → 400. Manual reselect then 201. Preview fallback name `"Device"` could enable submit with an empty ID.

### State synchronization behavior

`syncSelectedId(current, optionIds)`:

- Keep `current` if it is still in the list (do not clobber an explicit choice).
- If empty/stale and options exist, take the first option.
- If no options, `""`.

The select **value**, preview, `canSubmit`, and POST body all use the resolved id (`selectedIdOrNull` refuses empty). Duplicate-submit `busy` guard remains.

### Files changed

- `Code/src/ui/sync-selected-id.ts` (new)
- `Code/src/app/admin/gaming/_components/bulk-device-form.tsx`
- `Code/tests/ui/sync-selected-id.test.ts` (new)

### Automated tests

Empty → first option; preserve valid explicit id on refresh; stale id falls back; empty id is not submittable; refreshed first type is both visible and submittable.

### Browser regression

Org **QA Gaming Center** was already operationally ready (wizard Finish). Did **not** reset onboarding.

1. Devices page after creating **QA Batch2 Type**: select value was a real UUID matching visible **QA Device Type** (not `""`). Bulk POST 2 devices → **201**.
2. Guided Setup walked back to Device types, created **QA Batch2 Wizard Type**, advanced to Add devices **without** manually reselecting type. First POST body `deviceTypeId` was `01a04dfe-45b9-7291-f830-f643a5f454b4` (visible **QA Device Type**), **not** `""`. Devices **QA Device Type - 03** and **- 04** appeared. The brand-new wizard type was created (`201`) but not yet in the select on that first paint (refresh lag); the form kept the previous valid selection instead of submitting empty.

Empty-list → first-new-type path is covered by unit tests; this org already had types so the list was never empty.

### Remaining risk

- Wizard still calls `router.refresh()` without awaiting before `setIndex + 1`. The form now heals empty/stale ids; the first option may be an older type until refresh completes if types already existed. That is intentional preservation of a valid selection, not the original empty-ID bug.

## BUG-006 — Arabic locale not applied to several admin modules

**Status:** FIXED (confirmed modules only)

### Root cause

Confirmed modules hard-coded English chrome (`Customers`, `Reports`, `Staff`, `Roles`, `Activity`, `Filter`, `Add one device`, hub **Floor setup**) instead of `getRequestLocale()` + `t()`. Dictionaries already had many keys.

### Routes corrected

- `/admin/customers` (list + create form chrome)
- `/admin/reports`
- `/admin/users`
- `/admin/roles`
- `/admin/audit` (**page chrome only**; action-key mapping left for BUG-012)
- `/admin/gaming` hub
- `/admin/gaming/devices` including list filters

### i18n keys added/reused

Existing `getRequestLocale()` / `t()` / `ar`+`en` catalogs. No second i18n system. Added/extended groups including `hub.*`, `access.customers|reports|staff|roles|activity|floorSetup`, `common.filter|load|archived|status`, `status.customer.*`, customers/users/roles/reports/audit/devices chrome strings, `devices.typeRequired`, `customers.displayNamePlaceholder`. `ar`/`en` key parity is asserted.

Left for later (not this bug): raw API errors (BUG-009), duration copy (BUG-010), payment method **names from DB** (BUG-011), audit action fallbacks such as `gaming session ended` (BUG-012), settings mixed English, areas/device-types/pricing/device-detail pages, stored role name `Owner`.

### Files changed

- `Code/src/i18n/messages/en.ts` / `Code/src/i18n/messages/ar.ts`
- `Code/src/app/_lib/display.ts` (`customerStatusLabel`)
- `Code/src/app/admin/customers/page.tsx`
- `Code/src/app/admin/customers/[customerId]/page.tsx`
- `Code/src/app/admin/_components/customer-create-form.tsx`
- `Code/src/app/admin/reports/page.tsx`
- `Code/src/app/admin/users/page.tsx`
- `Code/src/app/admin/roles/page.tsx`
- `Code/src/app/admin/audit/page.tsx`
- `Code/src/app/admin/gaming/page.tsx`
- `Code/src/app/admin/gaming/devices/page.tsx`
- `Code/src/app/admin/gaming/_components/device-create-form.tsx`
- `Code/tests/i18n/bug-006-chrome.test.ts` (new)
- `Code/tests/i18n/locale.test.ts` (parity + BUG-006 key assertions)

### Automated tests

Catalog key parity; BUG-006 keys exist in both locales and are not identity-equal; confirmed pages call `getRequestLocale()` / `t(locale,` and no longer hard-code the original English titles/`Filter`/`Add one device`.

### Browser regression

Arabic: titles/descriptions/primary actions/table headers/filters matched Arabic catalogs on all seven confirmed routes (customers **الزبائن**, reports **التقارير**, users **الموظفون**, roles **الأدوار**, audit **النشاط**, hub **إعداد الصالة**, devices **الأجهزة** / **تصفية** / **إضافة جهاز واحد**). English switch restored **Customers**, **Reports**, **Staff**, **Roles**, **Activity**, **Floor setup**, **Filter**, **Add one device**.

Audit rows still show some English action leftovers (`gaming session ended`) — BUG-012, not this batch.

### Remaining risk

- This is **not** full-product Arabic. Areas, device types, pricing, sessions, settings, device detail, and login (BUG-022) remain mixed or English.
- Permission catalog **names** and stored role **Owner** are data, not page chrome.

## Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`. **Did not** mutate hosted Supabase. **Did not** reset PostgreSQL. Migrations **0001–0013** unchanged.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **55 files / 365 tests passed** |
| `npm run build` | PASS (Next.js 15.5.23) |

Fix Batch 1 baseline was 52 files / 353 tests. New files: `shell-layout`, `sync-selected-id`, `bug-006-chrome` (+ extra cases in existing locale/sync tests).

BUG-004 HTTP sign-out tests still PASS (3). BUG-005 `billing-prorated.test.ts` (24) and `billing.test.ts` including “charges the PRORATED_HOUR 5-minute minimum once after MOVE” still PASS (13 in `billing.test.ts`).

Browser logout: `POST /api/auth/sign-out` JSON → **200** `{ success: true }`; `GET /admin` redirected to `/login`.

## Latest release recommendation

**READY WITH REQUIRED MEDIUM FIXES**

High bugs from this audit are **0**. Release is no longer blocked by the original six High issues. Medium BUG-007–BUG-020 remain required before calling the product READY.

```text
FIX BATCH 2 COMPLETE

Critical: 0
High remaining: 0
Medium: 14 (BUG-007–BUG-020)
Low: 6 (BUG-021–BUG-026)

BUG-001: FIXED
BUG-002: FIXED
BUG-003: FIXED
BUG-006: FIXED (confirmed modules only)
BUG-004: FIXED (preserved)
BUG-005: FIXED (preserved)

Automated: 55 files / 365 tests
Release recommendation: READY WITH REQUIRED MEDIUM FIXES
```

---

# Fix Batch 3A — BUG-007 / BUG-008 / BUG-017

**Date:** 2026-08-29 (implementation) / 2026-08-30 (clean automated re-run)  
**Scope (authorized only):** BUG-007 End → checkout path; BUG-008 Guided Setup overlay vs operational readiness; BUG-017 wizard Next/Skip/stepper gating.  
**Not in this batch:** BUG-009–BUG-016, BUG-018–BUG-026. No other bugs were implemented. Fix Batches 1 and 2 were preserved.

Original sections 1–25 above are unchanged historical evidence. This section records the third implementation/regression pass.

**Local HEAD at this batch:** still `5fe4e63` on `master`. Working tree remains dirty (UX/product pass plus Fix Batches 1–2 plus this batch). Nothing committed or pushed.

## BUG-007 — Ending a session leaves operator on Floor with no checkout path

**Status:** FIXED

### Root cause

Confirmed against current Floor code, not assumed from the QA hypothesis.

`FloorDeviceActions` ended a session with `ActionButton`, which on success only called `router.refresh()`. The End API already returns `{ data: session }` including `id`. Billing is auto-finalized on End. The operator stayed on the Floor with the device free and no Bill/Checkout action.

### Implementation

Chosen UX: **successful End redirects to** `/admin/gaming/sessions/[sessionId]/checkout`.

- Pure helper `endedSessionCheckoutHref` reads `data.id` from the End JSON body, requires a UUID, and optionally must match the session id that was posted. It does not guess or re-query.
- `ActionButton` accepts optional `successHrefFromBody`. On success with an href, `router.push`; on success without, `refresh`; on failure, remain and show the existing error span. In-flight guard blocks double submit.
- Floor End wires `successHrefFromBody={(body) => endedSessionCheckoutHref(body, sessionId)}`.
- Session detail End is unchanged (already has checkout nearby).
- Payment rules, finalization, and auto-payment were not changed.

### Failure behavior

Invalid/failed End stays on Floor (no navigation). Confirm Cancel stays on Floor. Repeated End remains safe (busy/in-flight + domain Conflict on a second End).

### Files changed

- `Code/src/ui/session-checkout.ts` (new)
- `Code/src/app/admin/_components/controls.tsx`
- `Code/src/app/admin/gaming/_components/floor-device-actions.tsx`
- `Code/tests/ui/session-checkout.test.ts` (new)
- `Code/tests/onboarding/bug-007-008-017-wiring.test.ts` (new)

### Automated regression evidence

`session-checkout.test.ts`: End body `{ data: { id } }` → checkout path; `ok: false` → no href; mismatched id → no href; malformed body → no href.

Wiring: Floor End uses `endedSessionCheckoutHref` + `successHrefFromBody`.

### Browser regression evidence

Playwright against `http://localhost:3000`, existing local Owner, org **QA Gaming Center**. No new first owner. No DB reset.

1. `QA Station - 02` was Free. Guest **Start** succeeded (Occupied / Playing · Guest).
2. Invalid End URL → **400**; URL remained Floor; device still Occupied.
3. End → Cancel confirm: stayed on Floor; End still present.
4. End → Confirm: navigated to `/admin/gaming/sessions/01a04f22-2eca-7f97-4af6-4fcb18d45003/checkout`.
5. Checkout **#4**, Guest, play bill **10 SYP**, remaining **10 SYP**, **Unpaid**, “No payments recorded yet” (no auto-payment).
6. Refresh kept the same checkout URL and session.
7. Browser **Back** returned to Floor; station **Free**; six Start buttons; no End.

### Remaining risk

- If End returns HTTP 200 without a usable `data.id`, Floor refreshes in place (occupancy updates; operator would still hunt for the session). The End use-case always serializes the session id today.
- Session-detail End still refreshes in place by design.

## BUG-008 — Dashboard wizard overlay disappears once operationally ready

**Status:** FIXED

### Root cause

Confirmed against current Dashboard + `GuidedSetupHost`.

`operationallyReady` is `required.every(step => step.done)` (branch, area, type, device, plan, assignment, payments). Payments are seeded, so readiness becomes true after assignment. Dashboard then:

- skipped `loadOnboardingWizardLists` when `operationallyReady`
- `GuidedSetupHost` initialized closed and `return null` when ready

`/admin/onboarding` still had Staff (optional) and Finish. Operational readiness was incorrectly used as Guided Setup completion.

### Implementation

`operationallyReady` is **unchanged** (still derived from required rows).

Guided Setup presentation is separate:

- Presentation cookie `gc_guided_setup_done` (HttpOnly, SameSite=Lax, Path=/, per-organization UUID list). No progress table.
- Dashboard shows Guided Setup until that cookie records Finish for the current org.
- Auto-open overlay only while **not** operationally ready. When ready but unfinished: Continue Setup card, no auto-popup.
- Overlay no longer unmounts/closes when readiness flips mid-wizard.
- Finish (“Go to the Gaming Floor”) `POST /api/ui/guided-setup` `{ action: "complete" }` (requires setup permission + `operationallyReady`), then navigates to Floor.
- Close / Save & continue later still defers in-memory only; Continue Setup remains.
- `/admin/onboarding` remains a resume URL after completion.

### Files changed

- `Code/src/modules/onboarding/presentation.ts` (new)
- `Code/src/app/api/ui/guided-setup/route.ts` (new)
- `Code/src/app/admin/_components/guided-setup-host.tsx`
- `Code/src/app/admin/page.tsx`
- `Code/src/app/admin/onboarding/onboarding-wizard.tsx` (Finish completion POST)
- `Code/src/modules/onboarding/index.ts`
- `Code/src/i18n/messages/en.ts` / `ar.ts`
- `Code/tests/onboarding/presentation.test.ts` (new)
- `Code/tests/http/ui-guided-setup.test.ts` (new)
- `Code/tests/onboarding/setup-status.test.ts` (readiness ≠ auto-open)

### Automated regression evidence

Presentation: `operationallyReady=true` + not completed → still present, no auto-open; completed → neither present nor auto-open; cookie is org-scoped.

HTTP: unauthenticated complete → 401; not ready → 409 and no cookie; ready → 200 + `gc_guided_setup_done` HttpOnly/SameSite=Lax; `operationallyReady` in the body remains true.

Setup-status still derives `operationallyReady` from rows (staff optional/incomplete does not block readiness).

### Browser regression evidence

QA org was already operationally ready. Did **not** wipe setup.

1. Dashboard showed **Finish guided setup** + **Continue setup**; overlay did **not** auto-open.
2. Continue Setup opened the wizard on Finish (“You’re ready”); Close returned to Continue Setup (still available).
3. **Go to the Gaming Floor** succeeded → `/admin/gaming/floor`.
4. Dashboard reload: Continue Setup gone; no overlay; normal occupancy/activity chrome.
5. `/admin/onboarding` still loaded (Arabic then English) with Finish / Go to Floor.

### Remaining risk

- Completion is a presentation cookie, not a database row. Clearing cookies (or another browser) will show Continue Setup again until Finish is clicked. That is intentional and cheap to reverse.
- Completing org A does not complete org B.

## BUG-017 — Wizard Next can advance without saving current step

**Status:** FIXED

### Root cause

Confirmed: toolbar Next was `setIndex((value) => value + 1)` with no check against `getGamingCenterSetupStatus`. Skip was also exposed on Welcome and Payments (required in status). Area and Device Type forms auto-advanced after one create. Stepper titles were not buttons.

### Implementation

Shared flow in `wizard-flow.ts` using the same `SetupStepStatus` rows:

- **Required Next:** only if that step’s `done` is true (Welcome has no row → always allowed).
- **Skip:** only `optional === true` (Staff). Not on required steps, Welcome, or Payments.
- **Clickable stepper:** completed / dependency-satisfied future steps clickable; blocked titles `disabled`. Same prerequisite rule as Next (all earlier required rows done).
- **Multi-entry** (Areas, Device Types, Devices, Pricing): do **not** auto-advance after create; stay, show success, explicit Next. Branch still auto-advances after a successful first save.
- Initial index still derived from real rows (`operationallyReady` → Finish; else first incomplete). Refresh / `/admin/onboarding` remount from data, not a URL step index.

### Files changed

- `Code/src/modules/onboarding/wizard-flow.ts` (new)
- `Code/src/app/admin/onboarding/onboarding-wizard.tsx`
- `Code/src/app/admin/gaming/_components/bulk-device-form.tsx` (`onSuccess`)
- `Code/src/app/admin/gaming/_components/pricing-plan-form.tsx` (`onSuccess`)
- `Code/src/app/admin/gaming/_components/assignment-form.tsx` (`onSuccess`)
- `Code/src/app/globals.css` (stepper buttons)
- `Code/tests/onboarding/wizard-flow.test.ts` (new)

### Automated regression evidence

Missing required Branch → Next blocked; cannot open Areas/Devices. Branch done → Next allowed. Multi-entry `shouldAutoAdvanceWizardForm` false. Blocked title cannot jump to Devices/Finish. Skip only on Staff. Dependency-satisfied Staff/Finish clickable. Resume index from rows (incomplete branch → Welcome; branch done → Areas; ready → Finish).

### Browser regression evidence

QA org already had required data; clean empty-branch Next-block is unit-tested.

1. Staff: **Skip** present. Areas: **no Skip**; **Next** enabled; hint “Save as many as you need, then press Next.”
2. Created **QA Batch3A Area**: stayed on Areas; success “Saved. You can add another, then press Next.”
3. Stepper titles on `/admin/onboarding` were buttons; none disabled while required data existed. Direct URL `/admin/onboarding` derived Finish from actual rows.

### Remaining risk

- Browser Back/Forward does not encode wizard step in the URL (pre-existing). Remount uses product data.
- `QA Batch3A Area` remains in the local QA org.

## New bug discovered (not fixed)

### BUG-027 — Login form GET-submits credentials when client JS does not hydrate

**Severity:** High (originally recorded as Low in Fix Batch 3A; corrected in Fix Batch 3B after confirming credentials in the URL)  
**Category:** Security / Functional (originally Auth / UX)  
Observed while a stale `next dev` bundle left login without hydration: native submit (no `method="POST"`) produced `/login?email=…&password=…`. After restarting `next dev`, JSON `POST /api/auth/sign-in/email` worked. Not in this batch (Fix Batch 3A). Implemented in Fix Batch 3B.

## Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`. **Did not** mutate hosted Supabase. **Did not** reset PostgreSQL. Migrations **0001–0013** unchanged.

An overnight `npm test` hit a 30s timeout in unrelated `organizations.test.ts` (“rejects duplicate memberships…”) after the suite had been running for many hours. Isolated re-run of that file: **12/12 PASS**. Clean full re-run:

| Command | Result |
|---|---|
| `npm run typecheck` | PASS (earlier this batch) |
| `npm run lint` | PASS (earlier this batch) |
| `npm test` | **60 files / 387 tests passed** |
| `npm run build` | **PASS** (Next.js 15.5.23, ~176s) |

Fix Batch 2 baseline was 55 files / 365 tests. New tests: `session-checkout`, `wizard-flow`, `presentation`, `bug-007-008-017-wiring`, `ui-guided-setup`.

BUG-004 `sign-out.test.ts` still PASS (3). BUG-005 `billing-prorated.test.ts` (24) and `billing.test.ts` including “charges the PRORATED_HOUR 5-minute minimum once after MOVE” still PASS (13). `shell-layout.test.ts` (5), `sync-selected-id.test.ts` (5), `bug-006-chrome.test.ts` (1) still PASS.

## Latest release recommendation

**READY WITH REQUIRED MEDIUM FIXES**

High remaining: **0**. Medium remaining from this audit: BUG-009–BUG-016, BUG-018–BUG-020 (11). Low: BUG-021–BUG-027.

```text
FIX BATCH 3A COMPLETE

Critical: 0
High remaining: 0
Medium remaining: 11 (BUG-009–BUG-016, BUG-018–BUG-020)
Low: 7 (BUG-021–BUG-027)

BUG-007: FIXED
BUG-008: FIXED
BUG-017: FIXED
BUG-004: FIXED (preserved)
BUG-005: FIXED (preserved)
BUG-001: FIXED (preserved)
BUG-002: FIXED (preserved)
BUG-003: FIXED (preserved)
BUG-006: FIXED (preserved)

Automated: 60 files / 387 tests
Release recommendation: READY WITH REQUIRED MEDIUM FIXES
```

---

# Fix Batch 3B — BUG-027

**Date:** 2026-08-30  
**Scope (authorized only):** BUG-027 login form unsafe native GET fallback.  
**Not in this batch:** BUG-009–BUG-016, BUG-018–BUG-026. Setup form was **not** changed (see BUG-028 below). Fix Batches 1, 2, and 3A were preserved.

Original sections 1–25 and Fix Batches 1–3A above are unchanged historical evidence except the BUG-027 severity correction in the Batch 3A discovery note.

**Local HEAD at this batch:** still `5fe4e63` on `master`. Working tree remains dirty. Nothing committed or pushed.

## BUG-027 — Login form GET-submits credentials when JavaScript is unavailable or hydration fails

**Status:** FIXED

**Original severity:** Low (Auth / UX), recorded during Fix Batch 3A  
**Final severity:** **High** — Security / Functional

### Root cause

Confirmed against the current `/login` implementation, not assumed from the QA note.

`LoginForm` is a client component. Sign-in is `fetch` JSON `POST /api/auth/sign-in/email` (Better Auth) after `event.preventDefault()`. The `<form>` had **no `method` and no `action`**. HTML’s default method is **GET**, and React’s `onSubmit` is not present in SSR HTML, so a native submit before hydration (or with JavaScript disabled) serialized `email` and `password` into the query string:

`/login?email=…&password=…`

That URL can appear in browser history, the address bar, server access logs, proxies, analytics that record URLs, and some Referer cases.

### Exact credential-leak risk

Named credential fields on a method-less form → native GET → credentials in the navigation URL. Reproduction matched Batch 3A (stale `next dev` / failed hydration).

### Progressive enhancement decision

Login is **not** intended to work without JavaScript. The admin console, i18n `useT()`, theme switcher, and Better Auth JSON client path are all JS. No server-action sign-in exists in this codebase.

Chosen strategy: **fail closed without JS**, without a second authentication system and without a dummy auth endpoint.

- Hydrated path: unchanged Better Auth JSON POST, then `router.push("/admin")`.
- Native/degraded path: explicit `method="post"` `action="/login"` (and the same on the submit button via `formMethod` / `formAction`) so a native submit is never GET. POST `/login` re-renders the login page, **does not** mint a session, **does not** reflect the password, and sets no session cookie.
- `<noscript>` explains that sign-in needs JavaScript.
- If a credential query key is already present on `/login`, the page `redirect("/login")` with a **static** path (values are never copied into the redirect).

### Implementation

- Shared helpers in `login-form-safety.ts`: native method/action constants, HTML GET detection, native navigation URL, credential-query redirect, URL credential detection.
- Login form uses those constants; hydrated submit still `preventDefault` + JSON POST to `/api/auth/sign-in/email`.
- Login page strips credential query keys **before** `redirectIfAuthenticated` so an authenticated hop to `/admin` cannot carry `?password=` as Referer.

### Normal JS behavior

After hydration: invalid credentials stay on `/login` with an error; network is `POST /api/auth/sign-in/email` with no credentials in the URL. Valid existing Owner sign-in → `/admin`. Authenticated `/login` → `/admin`. Sign out (BUG-004) → `/login`.

### No-JS / degraded behavior

Playwright `javaScriptEnabled: false`: form `method=post` `action=/login`; noscript message visible; fill + submit stayed on `http://localhost:3000/login`; network was `GET /login` then `POST /login` with **no** query credentials. Curl: `GET /login?email=…&password=…` → **307** `Location: /login` (no values copied). Native `POST /login` → 200 login HTML, no session cookie, password not reflected.

### Automated regression evidence

- `tests/ui/login-form-safety.test.ts`: missing method GET-encodes a password marker into the URL; declared POST `/login` does not; credential-query redirect is static `/login`; hydrated Better Auth path is JSON POST.
- `tests/http/login-form-bug-027.test.ts`: source wiring (`method={LOGIN_FORM_NATIVE_METHOD}`, no GET, `preventDefault`, Better Auth path); JSON POST sign-in succeeds without credentials in the request URL; wrong password is rejected without encoding it in a URL.
- BUG-004 `sign-out.test.ts` still PASS (3).

### Browser regression evidence

Playwright against `http://localhost:3000/login`. Existing local Owner (display name **Cursor Test**; org **QA Gaming Center**). Credentials not recorded here. Disposable markers used for leak checks (`qa-bug027@example.test` / a unique password marker). No password screenshots.

1. SSR HTML: `<form class="stack" action="/login" method="post">`; submit button `formMethod="post"` `formAction="/login"`; `<noscript>` present.
2. No-JS context: Enter/click did **not** GET-submit; URL stayed `/login`; no marker in Network URLs or history/location.
3. Hydrated invalid login: `POST /api/auth/sign-in/email`; stayed on `/login`; error shown; URL clean.
4. Hydrated valid login: `POST /api/auth/sign-in/email` → `/admin`; URL clean.
5. Sign out → `/login`. Authenticated `/login` → `/admin`.
6. No accidental GET request contained credentials.

### Files changed

- `Code/src/auth/login-form-safety.ts` (new)
- `Code/src/app/login/login-form.tsx`
- `Code/src/app/login/page.tsx`
- `Code/src/i18n/messages/en.ts` / `ar.ts` (`login.javascriptRequired`)
- `Code/tests/ui/login-form-safety.test.ts` (new)
- `Code/tests/http/login-form-bug-027.test.ts` (new)

### Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`. **Did not** mutate hosted Supabase. **Did not** reset PostgreSQL. Migrations **0001–0013** unchanged.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **62 files / 397 tests passed** |
| `npm run build` | **PASS** (Next.js 15.5.23) |

Fix Batch 3A baseline was 60 files / 387 tests. New tests: `login-form-safety` (6), `login-form-bug-027` (4).

BUG-004 `sign-out.test.ts` still PASS (3). BUG-005 `billing-prorated.test.ts` (24) and `billing.test.ts` including “charges the PRORATED_HOUR 5-minute minimum once after MOVE” still PASS (13). `shell-layout.test.ts` (5), `sync-selected-id.test.ts` (5), `bug-006-chrome.test.ts` (1), `session-checkout.test.ts` (4), `wizard-flow.test.ts` (7), `presentation.test.ts` (5), `ui-guided-setup.test.ts` (3) still PASS.

### New bug discovered (not fixed)

### BUG-028 — First-owner setup form has the same native GET credential fallback

**Severity:** High  
**Category:** Security / Functional  
`Code/src/app/setup/setup-form.tsx` is also a client-only JSON form with **no `method`**. Native submit before hydration would GET-serialize `name`, `email`, `password`, and `bootstrapToken` into `/setup?…`. Out of scope for this batch (BUG-027 only). Reported here; not implemented.

## Latest release recommendation

**READY WITH REQUIRED MEDIUM FIXES**, with **one new High** (BUG-028) remaining outside this batch.

Original-audit High remaining after BUG-027: **0**. Remaining High including the new finding: **1** (BUG-028). Medium remaining: BUG-009–BUG-016, BUG-018–BUG-020 (11). Low: BUG-021–BUG-026.

```text
FIX BATCH 3B COMPLETE

Critical: 0
High remaining: 1 (BUG-028 setup form GET fallback — discovered, not fixed)
Medium remaining: 11 (BUG-009–BUG-016, BUG-018–BUG-020)
Low: 6 (BUG-021–BUG-026)

BUG-027: FIXED (severity corrected Low → High)
BUG-007: FIXED (preserved)
BUG-008: FIXED (preserved)
BUG-017: FIXED (preserved)
BUG-004: FIXED (preserved)
BUG-005: FIXED (preserved)
BUG-001: FIXED (preserved)
BUG-002: FIXED (preserved)
BUG-003: FIXED (preserved)
BUG-006: FIXED (preserved)

Automated: 62 files / 397 tests
Release recommendation: READY WITH REQUIRED MEDIUM FIXES (plus new High BUG-028)
```

---

# Fix Batch 3C — BUG-009 / BUG-010 / BUG-011 / BUG-012 / BUG-013 / BUG-018 / BUG-019

**Date:** 2026-08-30  
**Scope (authorized only):** BUG-009, BUG-010, BUG-011, BUG-012, BUG-013, BUG-018, BUG-019.  
**Not in this batch:** BUG-014, BUG-015, BUG-016, BUG-020, BUG-021–BUG-026, BUG-028. Fix Batches 1, 2, 3A, and 3B were preserved.

Original sections 1–25 and Fix Batches 1–3B above are unchanged historical evidence.

**Local HEAD at this batch:** still `5fe4e63` on `master`. Working tree remains dirty. Nothing committed or pushed.

Fix Batch 3B is recorded complete above (BUG-027 FIXED). This batch starts from that verified baseline (62 files / 397 tests, build PASS) plus subsequent working-tree work.

## BUG-009 — Server/domain validation errors shown as raw English in Arabic UI

**Status:** FIXED

**Root cause:** `ValidationError` / `ConflictError` were message-only. HTTP mapping sent `{ code, message }` with English `message`. Checkout/bulk/shared forms displayed `error.message`. Structured reasons already existed for checkout ineligibility (`OPEN_SESSION`, etc.) but were printed raw.

**Implementation:** Optional stable `reason` on domain errors → JSON `error.reason` → UI `displayApiError(reason → i18n key)`. English `message` kept on the API. Arabic does not fall back to English message text. Unsafe strings (SQL/stack) are never shown.

**Errors covered:** guest full-pay, zero payment, overpayment, invalid input, currency mismatch, unsupported method, missing reference, bill already settled, checkout ineligible codes.

**Files changed:** `Code/src/core/errors.ts`, `Code/src/app/api/_lib/handler.ts`, `Code/src/modules/finance/checkout.ts`, `Code/src/i18n/api-error.ts`, `Code/src/app/admin/_components/api.ts`, shared form `setError` callers, catalogs.

**Automated evidence:** `tests/i18n/bug-009-api-error.test.ts`; checkout domain tests now assert `reason` on guest/zero/overpay.

**Browser evidence:** Arabic checkout guest 1 SYP → `يجب دفع جلسات الزائر بالكامل` (API `reason: guest_must_pay_in_full`, English `message` not shown). Zero → `يجب أن يكون مبلغ الدفع أكبر من صفر`. Overpay → `المبلغ أكبر من المتبقي`. English UI: the three original English sentences. Bulk POST invalid body → `reason: invalid_input`.

**Remaining risks:** Other endpoints without a `reason` still map via HTTP `code` (generic) or English-only on `en`. Not full-product i18n.

## BUG-010 — Bill/session duration text is English on Arabic pages

**Status:** FIXED

**Root cause:** `formatDurationSeconds` is English-only presentation used on session bill/segment UI.

**Implementation:** Locale-aware `formatDurationForDisplay` (presentation only). Stored seconds and billing arithmetic unchanged. `formatDurationSeconds` kept for English billing-copy helpers/tests.

**AR examples:** `34 ثانية`, `5 دقائق`, `دقيقتان و 58 ثانية`, `0 دقيقة`.  
**EN examples:** `2 minutes 58 seconds`, `5 minutes`, `25 seconds`, `1 hour` (formatter).

**Files changed:** `Code/src/i18n/duration.ts`, session detail page, catalogs.

**Automated evidence:** `tests/i18n/bug-010-duration.test.ts`. Existing `tests/core/duration.test.ts` still expects `"1 hour"`.

**Browser evidence:** Arabic session totals/segments use Arabic duration phrases (no `minutes`/`seconds`). English session `#1` showed `Play time: 2 minutes 58 seconds`.

**Remaining risks:** Elapsed floor timer remains `HH:MM:SS` digits (not this bug).

## BUG-011 — Payment method labels render as English/internal values

**Status:** FIXED

**Root cause:** UI rendered stored method `name` (`Cash` / `ShamCash`). Codes `CASH` / `SHAMCASH` were already correct.

**Implementation:** `paymentMethodLabel(code, locale)` for Checkout select, payment history, and Reports method column. Stored codes and DB English names unchanged. ShamCash remains MANUAL staff-recorded. No ShamCash API.

**Files changed:** `Code/src/i18n/payment-method.ts`, checkout form/page, reports page.

**Automated evidence:** `tests/i18n/bug-011-payment-method.test.ts`.

**Browser evidence:** Arabic select/history/reports: `نقد` / `شام كاش`. English: `Cash` / `ShamCash`.

**Remaining risks:** Unknown future method codes fall back to stored name.

## BUG-012 — Audit/activity action labels untranslated or mismatched

**Status:** FIXED

**Root cause:** End is stored as `gaming.session.ended`; the dictionary had `gaming.session.completed`. `tGroup` fell back to `key.replaceAll(".", " ")` → `gaming session ended`. Many emitted actions were missing.

**Implementation:** Display mapping only (no audit-row mutation). `gaming.session.ended` aliases to the same label as completed. Expanded `auditAction` for currently emitted actions. Unknown future actions → `audit.unknownAction` (no dotted keys).

**Files changed:** `Code/src/i18n/t.ts`, `Code/src/app/_lib/display.ts`, catalogs.

**Automated evidence:** `tests/i18n/bug-012-audit-action.test.ts`.

**Browser evidence:** Arabic dashboard/audit: `انتهت جلسة`, `بدأت جلسة`, `نُقلت جلسة`, `أُضيف جهاز`, `سُجّلت دفعة`. English: `Session ended`, `Session started`, `Session moved`, `Device added`. No `gaming session ended`.

**Remaining risks:** Truly unknown historical actions show the generic “Activity recorded” / `تم تسجيل نشاط` fallback.

## BUG-013 — Completed session header device shows "—"

**Status:** FIXED

**Root cause:** End/cancel clears `currentDeviceId`. Header only read that field. Segments still had `deviceId`.

**Implementation:** Presentation from historical segments. Do not restore `currentDeviceId`. Active/paused: current device. Completed single-device: that name. MOVE/multi-device: last segment device + localized “(after move)” / `(بعد النقل)`.

**Files changed:** `Code/src/ui/session-device.ts`, session detail header.

**Automated evidence:** `tests/ui/session-device.test.ts`.

**Browser evidence:** Completed `#1` → `QA Station - 01`. Completed moved → `QA Station - 02 (بعد النقل)` / `(after move)`. Newly ended guest → `QA Device Type - 01`. Active floor tile still showed the live device name before End.

**Remaining risks:** Sessions **list** column may still dash when `currentDeviceId` is null (header was the confirmed QA surface).

## BUG-018 — Reports UTC date semantics vs organization timezone

**Status:** FIXED

**Root cause:** Reports labels `From (UTC)` / `Day (UTC)`. datetime-local used UTC components. SQL `date_trunc('day', timestamptz)` was UTC. Dashboard already used org-TZ start-of-day for the window, so grouping disagreed near midnight.

**Implementation:** Organization stored timezone (`Asia/Riyadh` on the QA org). Filter bounds and calendar-day grouping use that IANA zone. `timestamptz` storage unchanged. Reused `startOfDayInTimeZone` / added calendar-day helpers. Dashboard `to` is next business-day start (DST-safe).

**Files changed:** `Code/src/core/time.ts`, `Code/src/modules/reports/reports.ts`, reports page, dashboard, catalogs.

**Automated evidence:** `tests/core/time.test.ts`; `tests/reports/reports.test.ts` Riyadh vs UTC grouping (`2026-01-01T21:30:00.000Z` → Riyadh `2026-01-02`). Default org TZ for seeded tests is `Asia/Damascus` (not hardcoded into product reports).

**Browser evidence:** Reports AR/EN: no operator-facing `(UTC)`. Hint/timezone field `Asia/Riyadh`. Labels `من`/`From`, `اليوم`/`Day`. Payment method column localized. Dashboard activity and Reports both follow the org zone (QA org is `Asia/Riyadh`).

**Remaining risks:** CSV `from`/`to` remain ISO instants (absolute). Outstanding `issuedAt` is now formatted in the org zone on the page.

## BUG-019 — Settings expose “default time unit = 60 seconds”

**Status:** FIXED

**Root cause:** `gaming.billing_unit_seconds` is a NUMBER setting used by legacy TIME_BASED `UNIT` plans. PRORATED_HOUR ignores it, but Settings always showed `60`.

**Implementation:** Hide from owner Settings unless an ACTIVE TIME_BASED plan has `timeBillingMode === UNIT`. If shown, DurationPicker (seconds still stored). Backend PUT unchanged. No stored-value rewrite.

**Files changed:** `Code/src/ui/billing-unit-setting.ts`, settings page, setting editor.

**Automated evidence:** `tests/ui/billing-unit-setting.test.ts`.

**Browser evidence:** QA tenant is PRORATED_HOUR-only: Settings shows timezone `Asia/Riyadh` and walk-in guests; no raw 60-second control. Legacy UNIT visibility covered by tests (did not change production tenant pricing).

**Remaining risks:** Settings chrome such as “Applies to” / features toggles can still be English (out of this batch).

## Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`. **Did not** mutate hosted Supabase. **Did not** reset PostgreSQL. Migrations **0001–0013** unchanged.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **69 files / 420 tests passed** |
| `npm run build` | **PASS** (Next.js 15.5.23) |

Previous-batch regression files still PASS, including `sign-out.test.ts`, `billing.test.ts` (MOVE minimum), `shell-layout.test.ts`, `sync-selected-id.test.ts`, `bug-006-chrome.test.ts`, `session-checkout.test.ts`, `wizard-flow.test.ts`, `presentation.test.ts`, `ui-guided-setup.test.ts`, `login-form-bug-027.test.ts`.

## New bugs discovered

None assigned. Sessions-list device dash after completion is a remaining risk of BUG-013 (header fixed), not a new ID.

## Latest release recommendation

**READY WITH REQUIRED MEDIUM FIXES**, with **one High** (BUG-028) remaining outside this batch.

```text
FIX BATCH 3C COMPLETE

Critical: 0
High remaining: 1 (BUG-028 setup form GET fallback — not in this batch)
Medium remaining: 4 (BUG-014, BUG-015, BUG-016, BUG-020)
Low: 6 (BUG-021–BUG-026)

BUG-009: FIXED
BUG-010: FIXED
BUG-011: FIXED
BUG-012: FIXED
BUG-013: FIXED
BUG-018: FIXED
BUG-019: FIXED
BUG-027: FIXED (preserved)
BUG-007: FIXED (preserved)
BUG-008: FIXED (preserved)
BUG-017: FIXED (preserved)
BUG-004: FIXED (preserved)
BUG-005: FIXED (preserved)
BUG-001: FIXED (preserved)
BUG-002: FIXED (preserved)
BUG-003: FIXED (preserved)
BUG-006: FIXED (preserved)

Automated: 69 files / 420 tests
Release recommendation: READY WITH REQUIRED MEDIUM FIXES (plus High BUG-028)
```

---

# Fix Batch 3D — BUG-028

**Date:** 2026-08-30  
**Scope (authorized only):** BUG-028 setup form unsafe native GET fallback.  
**Not in this batch:** BUG-014, BUG-015, BUG-016, BUG-020, BUG-021–BUG-026. Fix Batches 1, 2, 3A, 3B, and 3C were preserved.

Original sections 1–25 and Fix Batches 1–3C above are unchanged historical evidence. The original BUG-028 discovery in Fix Batch 3B is not erased.

**Local HEAD at this batch:** still `5fe4e63` on `master`. Working tree remains dirty. Nothing committed or pushed.

## BUG-028 — First-owner setup form GET-submits secrets when JavaScript does not hydrate

**Status:** FIXED

**Severity:** High  
**Category:** Security / Functional

### Discovery

Recorded in Fix Batch 3B while fixing BUG-027. Confirmed against **current** `/setup` code before this batch, not assumed from the QA note alone.

`SetupForm` is a client component. Bootstrap is JSON `POST /api/auth/sign-up/email` with header `x-gaming-bootstrap-token`, then JSON `POST /api/auth/sign-in/email`, after `event.preventDefault()`. The `<form>` had **no `method` and no `action`**. HTML’s default method is **GET**. React `onSubmit` is not present in SSR HTML, so a native submit before hydration (or with JavaScript disabled) would serialize the live fields into the query string.

### Root cause

Missing native form `method`/`action` on a named-field setup form whose real submit path is client `fetch`. Same HTML default as BUG-027.

### Sensitive fields at risk

Current setup fields (no `organizationName` field exists on this form):

- `name` (display name)
- `email`
- `password`
- `bootstrapToken` (setup secret; sent as header `x-gaming-bootstrap-token` on the hydrated path)

Forbidden native GET examples include `/setup?email=…&password=…&bootstrapToken=…`.

### Chosen safe form strategy

`/setup` is **not** intended to work without JavaScript. There is no server-action bootstrap and no second auth system.

Strategy: **fail closed without JS**, matching BUG-027.

- Hydrated path: unchanged Better Auth JSON sign-up (bootstrap header) + JSON sign-in, then `router.push("/admin")`.
- Native/degraded path: explicit `method="post"` `action="/setup"` (and the same on the submit button via `formMethod` / `formAction`) so a native submit is never GET. `POST /setup` re-runs the existing page, **does not** create an owner, **does not** mint a session, **does not** reflect submitted secrets.
- `<noscript>` explains that first-owner setup needs JavaScript.
- If a sensitive query key is already present on `/setup`, redirect to static `/setup` (values never copied). Existing-owner gating then runs on the clean request (`/login`).

### Normal hydrated behavior

`preventDefault` + `POST /api/auth/sign-up/email` with `x-gaming-bootstrap-token` + `POST /api/auth/sign-in/email`. Request URLs contain no setup secrets. Public signup without the token remains 403. Duplicate first-owner creation remains impossible (bootstrap tests preserved).

### Degraded/no-JS behavior

Native submit is POST `/setup`, never GET. With the current local DB (owner already exists): `POST /setup` → 307 `/login`; no session cookie; markers not reflected in HTML; final URL has no query secrets. `<noscript>` is present in the form source.

A non-functional no-JS setup is intentional and preferable to leaking secrets into a URL.

### Existing-owner `/setup` behavior

`GET /api/setup/status` → `firstUserRequired: false`.

- Unauthenticated `GET /setup` → 307 `/login`. No setup form.
- Authenticated `GET /setup` → 307 `/login` → 307 `/admin` (login still redirects a live session). No setup form.
- `GET /setup?email=…&password=…&bootstrapToken=…` → 307 `Location: /setup` (no values copied) → then `/login`.
- Owner row is unchanged. No second owner was created.

### Automated regression evidence

`tests/ui/setup-form-safety.test.ts`:

- Missing method GET-encodes password/token markers into the URL.
- Declared POST `/setup` does not.
- Sensitive-query redirect is static `/setup` and never copies values.
- Closed bootstrap with leaked query strips to `/setup` before `/login`.
- Hydrated Better Auth paths are JSON POST.

`tests/http/setup-form-bug-028.test.ts`:

- Form wiring: `method={SETUP_FORM_NATIVE_METHOD}`, no GET, `preventDefault`, sign-up/sign-in JSON paths, bootstrap header.
- Existing-owner `/setup` throws Next redirect to `/login` and does not add users.
- Leaked query redirect is `/setup` with no markers; user count unchanged.
- JSON POST sign-up with token succeeds; request URL has no secrets.
- Public signup without token remains **403**; no user created.
- BUG-027 login still declares POST `/login`.

Previous-batch files still PASS, including `login-form-bug-027.test.ts`, `sign-out.test.ts`, `bootstrap.test.ts`.

### Browser evidence

Against `http://localhost:3000`. Current local DB already has an Owner (**Cursor Test** / org **QA Gaming Center**). Did **not** reset bootstrap or create a second owner. Harmless markers only (`qa-bug028@example.test`, `pw-bug028-must-not-appear-in-url`, `tok-bug028-must-not-appear`). Credentials / tokens / cookies not recorded here.

**A. Existing-owner (BROWSER VERIFIED)**

1. Authenticated Playwright: `GET /setup` → 307 `/login` → 307 `/admin`. No setup form.
2. Anonymous Playwright: `GET /setup` → `/login`, heading sign-in (Arabic), `form[action=/setup]` count 0, no `bootstrapToken` field.
3. Curl: `GET /setup` → 307 `Location: /login`. `GET /api/setup/status` → `firstUserRequired: false`.

**B. Degraded form (BROWSER VERIFIED via native form semantics + live `/setup` POST; form HTML is unreachable on this DB because bootstrap is closed)**

1. Curl `GET /setup?email=…&password=…&bootstrapToken=…` → 307 `Location: /setup` (no markers in Location).
2. Curl `POST /setup` with form body markers → 307 `Location: /login` (no markers in Location).
3. Playwright `javaScriptEnabled: false` ephemeral form using production `method=post` `action=/setup` (click Submit and Enter): network `POST /setup` then `POST /login` (307 preserves method); **no** GET query secrets; final URL `http://localhost:3000/login`; HTML did not reflect markers; no session cookie.
4. Deliberate navigation to a leaked GET URL: follow-up requests were `GET /setup` then `GET /login`; final URL had no marker. The initial leaked GET is the leftover-URL case the strip redirect exists to clean.

**C. Normal successful first-owner setup (AUTOMATED VERIFIED only)**

Not forced in the browser (owner already exists). Covered by PGlite HTTP tests: JSON POST sign-up with bootstrap token creates exactly one user; URL has no secrets; second public signup remains fail-closed.

BUG-027 login no-JS: no-JS `/login` form still `method=post` `action=/login`; noscript still present.

Console: existing Next.js dev chunk/MIME 404s and `favicon.ico` 404 (BUG-021). Not introduced by this batch.

### Files changed

- `Code/src/auth/setup-form-safety.ts` (new)
- `Code/src/app/setup/setup-form.tsx`
- `Code/src/app/setup/page.tsx`
- `Code/src/i18n/messages/en.ts` / `ar.ts` (`setup.javascriptRequired`)
- `Code/tests/ui/setup-form-safety.test.ts` (new)
- `Code/tests/http/setup-form-bug-028.test.ts` (new)

### Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`. **Did not** mutate hosted Supabase. **Did not** reset PostgreSQL. Migrations **0001–0013** unchanged. No first-owner state reset.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **71 files / 435 tests passed** |
| `npm run build` | **PASS** (Next.js 15.5.23) |

Fix Batch 3C baseline was 69 files / 420 tests. New tests: `setup-form-safety` (7), `setup-form-bug-028` (8).

### Remaining risk

- Native `POST /setup` while bootstrap is closed follows Next.js **307** to `/login`, so the browser may POST the form body to `/login`. That is not a URL leak; `/login` still does not mint a session from native POST (BUG-027). Secrets are not reflected.
- Successful first-owner setup was not re-run in the browser because the local DB already has an owner.

### Remaining bug counts

- Critical: **0**
- High: **0**
- Medium remaining: **4** (BUG-014, BUG-015, BUG-016, BUG-020)
- Low: **6** (BUG-021–BUG-026)

### Release recommendation

**READY WITH REQUIRED MEDIUM FIXES**

High remaining: **0**. Next required batch is the remaining Medium UI/Responsive/Accessibility work (BUG-014 / BUG-015 / BUG-016 / BUG-020). Do not start Milestone 9.

```text
FIX BATCH 3D COMPLETE

Critical: 0
High remaining: 0
Medium remaining: 4 (BUG-014, BUG-015, BUG-016, BUG-020)
Low: 6 (BUG-021–BUG-026)

BUG-028: FIXED
BUG-027: FIXED (preserved)
BUG-009–013, 018, 019: FIXED (preserved)
BUG-007 / BUG-008 / BUG-017: FIXED (preserved)
BUG-004 / BUG-005: FIXED (preserved)
BUG-001 / BUG-002 / BUG-003 / BUG-006: FIXED (preserved)

Automated: 71 files / 435 tests
Release recommendation: READY WITH REQUIRED MEDIUM FIXES
```

---

# Fix Batch 3E — BUG-029

**Date:** 2026-08-30  
**Scope (authorized only):** BUG-029 closed-bootstrap / degraded POST `/setup` must not forward the sensitive POST body to `/login`.  
**Not in this batch:** BUG-014, BUG-015, BUG-016, BUG-020, BUG-021–BUG-026. Fix Batches 1, 2, 3A, 3B, 3C, and 3D were preserved. BUG-028 no-GET protection was not regressed.

Original sections 1–25 and Fix Batches 1–3D above are unchanged historical evidence. The 307 remaining-risk note in Fix Batch 3D is the discovery record for this bug.

**Local HEAD at this batch:** still `5fe4e63` on `master`. Working tree remains dirty. Nothing committed or pushed.

## BUG-029 — closed-bootstrap POST `/setup` 307-forwarded the setup body to `/login`

**Status:** FIXED

**Severity:** High  
**Category:** Security / Functional

### Discovery

Recorded as remaining risk in Fix Batch 3D after BUG-028. Confirmed against the **current** local tree before this batch, not assumed from the note alone.

Live `http://localhost:3000` (owner already exists, bootstrap closed):

```text
POST /setup  (form body with name/email/password/bootstrapToken markers)
→ 307 Temporary Redirect
→ Location: /login
→ digest NEXT_REDIRECT;replace;/login;307;
```

Playwright previously followed that 307 as **POST `/login`** with the same body (307 preserves method and body). That is not a URL leak and did not mint a session (BUG-027), but it sent setup secrets to an unintended endpoint.

### Root cause

`SetupPage` called `redirect(destination)` from `next/navigation`. In this Next.js **15.5.23** App Router:

- Server Component / Route Handler `redirect()` always throws **307 Temporary Redirect** (`RedirectStatusCode.TemporaryRedirect`).
- **308** is `permanentRedirect()` (`RedirectStatusCode.PermanentRedirect`). Both 307 and 308 replay method and body.
- **303 See Other** (`RedirectStatusCode.SeeOther`) is applied automatically only for **Server Actions**. Closed `/setup` never renders `SetupForm`, so there is no Server Action on that path. Opting into a Server Action would not cover native POST to a closed page.

`getRedirectError(url, type, statusCode)` is the same helper `redirect()` uses internally. Passing `RedirectStatusCode.SeeOther` makes the page response **303**, which browsers follow with **GET** and **no body**.

### Why 307 was unsafe

RFC 9110: 307/308 keep the original method and request body. A native POST of setup credentials therefore became POST `/login` with `password` and `bootstrapToken` in the body (logs, proxies, the login page request). 303 discards that body.

### Chosen redirect semantics

**303 See Other**, via Next.js `RedirectStatusCode.SeeOther` + `getRedirectError`, not a hardcoded magic status on `redirect()` (that API cannot select 303 from a Server Component).

Exact sequence after the fix (closed bootstrap):

```text
POST /setup   (sensitive form body)
→ 303 See Other
→ Location: /login
→ GET /login  (no body)
```

Not:

```text
POST /setup → 307 /login → POST /login (same body)
```

GET `/setup` while closed is also 303 `/login` (GET follow remains GET). Leaked-query strip still goes to static `/setup` first (BUG-028), then existing-owner gating. Open bootstrap still fail-closes: native POST does **not** create an owner and does **not** mint a session. Hydrated setup is unchanged (Better Auth JSON + bootstrap header).

### Automated evidence

`tests/ui/setup-form-safety.test.ts` (now 9): 307/308 preserve body; 303 follow is GET with `body: null`; markers stay out of the URL.

`tests/http/setup-form-bug-029.test.ts` (8):

1. `SETUP_PAGE_REDIRECT_STATUS` is `RedirectStatusCode.SeeOther` (303), not 307/308.
2. Framework `redirect()` from `next/navigation` is still 307 and would replay the POST body (documented, not used by `/setup`).
3. Closed-bootstrap `SetupPage` throws digest status **303** to `/login`; follow is GET; password and bootstrapToken markers are not in the next request body or URL; owner row unchanged.
4. Open setup still renders (no redirect), no user created.
5. Page wiring uses `redirectDiscardingRequestBody`, not default `redirect()`.
6. BUG-028: form still POST `/setup`, never GET.
7. BUG-027: login form still POST `/login`.
8. Public signup without token remains **403**.

`tests/http/setup-form-bug-028.test.ts` (8) still PASS.

### Browser / network evidence

Against `http://localhost:3000`. Local DB already has an Owner. Did **not** reset bootstrap or create a second owner. Harmless markers only (`qa-bug029@example.test`, `pw-bug029-must-not-reach-login`, `tok-bug029-must-not-reach-login`). Credentials / tokens / cookies not recorded here.

**Before (this batch, confirmed):** `POST /setup` → **307** `Location: /login`.

**After:**

Curl (no `-X POST`, so follow is RFC-correct): `POST /setup` → **303** `Location: /login` → **GET `/login`** → 200. Cookie jar empty. Markers not in Location or URL.

Playwright anonymous (cookies cleared), ephemeral native `method=post` `action=/setup`:

```text
POST /setup  (body contains markers) → 303
GET  /login  (postData: null)        → 200
```

No `POST /login`. Final URL `http://localhost:3000/login` (Arabic sign-in). Form `action=/login` `method=post`. Markers not in URL or HTML. No session cookie. `GET /api/setup/status` → `firstUserRequired: false`. Existing owner untouched.

### Files changed

- `Code/src/auth/setup-form-safety.ts` (303 helpers, HTTP follow model, digest parser)
- `Code/src/auth/setup-page-redirect.ts` (new; `getRedirectError` + `RedirectStatusCode.SeeOther`)
- `Code/src/app/setup/page.tsx`
- `Code/tests/ui/setup-form-safety.test.ts`
- `Code/tests/http/setup-form-bug-028.test.ts` (source assertion for the new helper)
- `Code/tests/http/setup-form-bug-029.test.ts` (new)

### Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`. **Did not** mutate hosted Supabase. **Did not** reset PostgreSQL. **Did not** reset first-owner state. Migrations **0001–0013** unchanged.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **72 files / 445 tests passed** |
| `npm run build` | **PASS** (Next.js 15.5.23) |

Fix Batch 3D baseline was 71 files / 435 tests. New: `setup-form-bug-029` (8) plus two cases in `setup-form-safety`.

### Remaining bug counts

- Critical: **0**
- High: **0**
- Medium remaining: **4** (BUG-014, BUG-015, BUG-016, BUG-020)
- Low: **6** (BUG-021–BUG-026)

### Release recommendation

**READY WITH REQUIRED MEDIUM FIXES**

High remaining: **0**. Next required batch is BUG-014 / BUG-015 / BUG-016 / BUG-020. Do not start Milestone 9.

```text
FIX BATCH 3E COMPLETE

Critical: 0
High remaining: 0
Medium remaining: 4 (BUG-014, BUG-015, BUG-016, BUG-020)
Low: 6 (BUG-021–BUG-026)

BUG-029: FIXED
BUG-028: FIXED (preserved)
BUG-027: FIXED (preserved)
BUG-009–013, 018, 019: FIXED (preserved)
BUG-007 / BUG-008 / BUG-017: FIXED (preserved)
BUG-004 / BUG-005: FIXED (preserved)
BUG-001 / BUG-002 / BUG-003 / BUG-006: FIXED (preserved)

Automated: 72 files / 445 tests
Release recommendation: READY WITH REQUIRED MEDIUM FIXES
```

---

# Fix Batch 4 — BUG-014 / BUG-015 / BUG-016 / BUG-020

**Date:** 2026-08-30  
**Scope:** Remaining Medium UI / Responsive / Accessibility only.  
**Not in this batch:** Low BUG-021–BUG-026. Fix Batches 1, 2, 3A–3E were preserved. No migrations. No billing/payment/session-state/Better Auth/RLS changes. Milestone 9 not started.

Original sections 1–25 and Fix Batches 1–3E above are unchanged historical evidence.

**Verified baseline at start of this batch (from Fix Batch 3E):** typecheck PASS, lint PASS, `npm test` 72 files / 445 tests PASS, build PASS. High: 0. Medium remaining: BUG-014, BUG-015, BUG-016, BUG-020.

---

## BUG-014 — FieldHelp clipped in RTL

**Status:** FIXED

**Root cause:** The help panel was positioned with CSS that assumed room on the preferred inline-start side. In RTL, that places the panel toward the physical left. Near the workspace edge the panel was painted outside the visible area. A global `overflow: visible` on the workspace was not used (and must not be used), so clipping was a placement problem, not a missing overflow rule.

**Implementation:** Collision-aware `position: fixed` coordinates from `placeFieldHelpPanel()`:

1. Prefer below + inline-start (dir-aware).
2. Flip inline-end if that side overflows.
3. Flip above if there is more room above (including when a bottom nav inset reduces space below).
4. Clamp into the viewport.

The **i** button remains the only interactive trigger. Desktop hover still opens (unpinned); click pins/unpins without racing `onFocus`; keyboard focus still opens on fine-pointer devices; Escape closes without immediately reopening when focus returns to the trigger (`skipFocusOpen`). Mobile tap pins open. Dark/Light inherit overlay tokens.

**Files changed:**

- `Code/src/ui/field-help-placement.ts` (new)
- `Code/src/app/_components/field-help.tsx`
- `Code/src/app/globals.css` (`.field-help-panel { position: fixed }`; no workspace `overflow: visible`)
- `Code/tests/ui/field-help-placement.test.ts` (new)

**Automated evidence:** Placement tests cover RTL left-edge flip, LTR right-edge flip, preferred inline-start, above + bottom-nav inset, tiny-viewport clamp, `readDocumentDir`, i-only trigger, Escape, and no global overflow-visible rule. `field-help-placement.test.ts` 8 tests PASS.

**Browser evidence:** `http://localhost:3000/admin/settings` and checkout/devices FieldHelp. Arabic RTL: panel fully in view, not under bottom nav. English LTR 1440: panel `left 457–745`, not clipped. Clicking the visible label does not open the panel. Escape closes. Dark scheme panel background `rgb(34, 44, 56)`, not clipped.

**Responsive evidence:** 390×844 (flips above or clamps; `left 8 / right 296` in a 390-wide view); 900×900; 1366×768; 1440×900. Checkout amount help at 390 RTL: trigger near the inline-start edge (`270–314`), panel `26–314`, not clipped.

**Accessibility evidence:** Trigger keeps `aria-expanded`, `aria-controls`, `aria-label` (help for the field title). Panel `role="note"`. 44×44 icon-btn. Keyboard Escape closes and does not leave a stuck open panel.

**Remaining risks:** Playwright Chromium reports `(hover: hover) and (pointer: fine)` even at a 390 CSS viewport, so mobile-hover vs tap was verified with `canHoverFine()` plus real tap/click, not by assuming the engine is a phone. Settings in this QA org only exposes one setting-level FieldHelp; edge cases were also checked on checkout and devices.

---

## BUG-015 — Occupied Floor tiles oversized / Cancel always expanded

**Status:** FIXED

**Root cause:** Occupied tiles rendered Pause / End / Move **and** a permanent cancellation `<textarea>` on the card. Grid default stretch made vacant tiles as tall as the occupied row (~600px), leaving large dead space.

**Implementation:**

- Primary occupied actions stay on the tile: Pause / Resume, End (existing confirm → checkout href), Move.
- Cancel is a secondary ghost control that opens the shared Overlay (`role="alertdialog"`). Reason lives **inside** the dialog. Keep session dismisses without calling cancel. Confirm still `POST /api/gaming/sessions/:id/cancel` with `{ reason }` — API/business rules unchanged.
- `.floor-grid { align-items: start }`; `.floor-tile { height: auto; align-self: start }`.

**Files changed:**

- `Code/src/app/admin/gaming/_components/floor-device-actions.tsx`
- `Code/src/app/globals.css` (floor grid / tile / primary vs secondary)
- `Code/src/i18n/messages/en.ts`, `Code/src/i18n/messages/ar.ts` (`floor.keepSession`)
- `Code/tests/ui/floor-density.test.ts` (new)

**Automated evidence:** Primary actions remain Pause/Resume/End/Move. No tile-level `type: "textarea"` / reason field array. Overlay + reason + keep/confirm + cancel API body. Grid `align-items: start`. 4 tests PASS.

**Browser evidence:** Floor at 390/900/1366. Available tiles **220px**. Occupied tiles **445px** (Pause, End, Move, optional Assign customer, Cancel trigger — **no** permanent textarea). Cancel opens “إلغاء الجلسة” with reason field and “إبقاء الجلسة”. Dismissed without cancelling. Pause → Resume verified on a disposable occupied tile, then resumed (both occupied devices show Pause again). No maintenance tile exists in this local QA set.

**Responsive evidence:** Vacant cards stay compact next to occupied cards (no row stretch). 390 single-column grid; 900+ multi-column with mixed 445/220 heights.

**Accessibility evidence:** Cancel trigger is a named button. Overlay is `alertdialog` labelled by the title. Reason uses FormField `label` + `htmlFor`.

**Remaining risks:** Occupied height is still larger than vacant because Move + Assign customer remain on-card (operational, not exceptional). That is compact versus the old ~600px stretch, not minimum-height-at-all-costs. Do not cancel a live business session to retest confirm; overlay dismiss was used here.

---

## BUG-016 — Mobile topbar wrap, Floor actions under bottom nav, Checkout table overflow

**Status:** FIXED (all three parts)

**Root cause:**

- A. Desktop language/theme `<select>` plus sign-out text wrapped the sticky topbar (~164px) at 390px.
- B. Primary actions could sit under a bottom nav that was not given shared content clearance (or overlapped the scrollport).
- C. Checkout payment history used a desktop table at phone width, forcing horizontal scroll.

**Implementation:**

- A. ≤1100px: icon language (EN/ع), icon theme cycle, icon sign-out. Desktop keeps compact selects. Topbar `flex-wrap: nowrap`; identity ellipsis. 44px targets + `aria-label`.
- B. Shared `--shell-content-bottom-clearance` on `.app-workspace > main` at ≤720px (nav height stays in-flow + padding uses `--space-5` + `safe-area-inset-bottom`). Not Floor-only.
- C. `CheckoutPaymentHistory` client wrapper + existing DataTable desktop table / mobile record-cards. All five columns: received, method, amount, reference, status. Rows are preformatted strings (RSC cannot pass cell functions to a client table).

**Files changed:**

- `Code/src/app/admin/_components/admin-shell.tsx`
- `Code/src/app/admin/_components/language-switcher.tsx`
- `Code/src/app/_components/theme-switcher.tsx`
- `Code/src/app/admin/_components/controls.tsx` (icon sign-out)
- `Code/src/app/_components/icons.tsx`
- `Code/src/app/admin/gaming/_components/checkout-history.tsx` (new)
- `Code/src/app/admin/gaming/sessions/[sessionId]/checkout/page.tsx`
- `Code/src/app/globals.css`
- `Code/src/ui/shell-layout.ts`
- `Code/tests/ui/bug-016-mobile-shell.test.ts` (new)
- `Code/tests/ui/shell-layout.test.ts` (extended)

**Automated evidence:** Compact icon wiring; DataTable cards on checkout; `checkoutHistoryLayout(390) === "cards"`; shared clearance CSS + `safe-area-inset-bottom`. Prior BUG-001/002 shell tests still PASS.

**Browser evidence (390×844):** Topbar **63px**, `nowrap`, compact prefs visible, desktop prefs hidden. Language/theme/sign-out 44×44 with names اللغة / السمة / تسجيل الخروج. Last Floor **بدء** scrolled into view: **20px gap** above bottom nav (nav 65px), not covered. Checkout #3 history: table `display:none`, cards `grid`, captions الاستلام / طريقة الدفع / المبلغ / المرجع / الحالة, no horizontal page scroll. Checkout #5 amount form: submit not under nav (20px gap). 1440 history: table `block`, cards `none`, no table overflow.

**Responsive evidence:** 900×900 compact icons, no bottom nav. 1366/1440 desktop selects, no bottom nav.

**Accessibility evidence:** Icon controls have a single `aria-label` (no wrapping visible label). Features not removed.

**Remaining risks:** Empty payment history still uses the DataTable empty `<p>` (no table/cards) — correct, no data to show. Guest full-pay notice after PAID remains BUG-023 (Low, not fixed).

---

## BUG-020 — Duplicate accessible names

**Status:** FIXED

**Root cause:** Visible `<label>` text was combined with a second `aria-label` (money “amount in SYP”, Floor customer optional repeated, Staff `id="api-field-email"` reused so two Email labels concatenated). Currency and optional hints were packed into the **name** instead of a **description**.

**Implementation:** One name per control:

- Visible `<label htmlFor>` (optional announced once inside the label).
- Helpers, currency, errors via `aria-describedby` (`joinDescribedBy`).
- `MoneyInput`: no `aria-label`; currency `aria-hidden`; hint described.
- `ApiForm`: unique ids `${formId}-${field.name}`.
- Floor customer: `t("floor.customer")` + `optional: true` (not a second optional phrase + aria-label).
- Language/theme full Settings: `htmlFor` + described hint; compact/icon: name only from `aria-label`.

**Files changed:**

- `Code/src/ui/accessible-name.ts` (new)
- `Code/src/app/_components/form-field.tsx`
- `Code/src/app/_components/money-input.tsx`
- `Code/src/app/_components/combobox.tsx` (id / labelledBy; no combobox `aria-label`)
- `Code/src/app/admin/gaming/_components/checkout-form.tsx`
- `Code/src/app/admin/gaming/_components/floor-device-actions.tsx`
- `Code/src/app/admin/_components/controls.tsx`
- `Code/src/app/admin/_components/language-switcher.tsx`
- `Code/src/app/_components/theme-switcher.tsx`
- `Code/tests/ui/accessible-name.test.ts` (new)

**Automated evidence:** Duplicate-name helper; checkout amount has FormField label and MoneyInput has no aria-label; Floor customer optional once; Staff unique ids; FormField helper/error `aria-describedby`; Combobox unnamed via aria-label. 7 tests PASS.

**Browser evidence:** Checkout amount accessible name **المبلغ** (no aria-label); described **مبالغ صحيحة فقط لعملة SYP.** Reference **المرجع (اختياري)**. Floor available customer **الزبون (اختياري)**; assign customer **الزبون**; no aria-label. Users: two email inputs, distinct ids, name **البريد الإلكتروني**, no aria-label (no “Email Email”).

**Responsive evidence:** Same name model at 390 and 1440.

**Accessibility evidence:** Tab/click still reaches labeled controls. Error `role="alert"` remains on FormField. Helper/error stay descriptions.

**Remaining risks:** Combobox is not currently mounted on Floor (native `<select>`). Primitive is still named via `id` / optional `labelledBy` for when it is used.

---

### Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`. **Did not** mutate hosted Supabase. **Did not** reset PostgreSQL. Migrations **0001–0013** unchanged. Nothing committed, pushed, or deployed.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **76 files / 469 tests passed** |
| `npm run build` | **PASS** (Next.js 15.5.23) |

Fix Batch 3E baseline was 72 files / 445 tests. New/extended: `field-help-placement` (8), `floor-density` (4), `bug-016-mobile-shell` (2), `accessible-name` (7), `shell-layout` mobile cases. Prior batch tests (login/setup, logout, billing, End→Checkout, drawer/sidebar, Guided Setup, localized checkout, reports timezone) remained green.

### Remaining bug counts

- Critical: **0**
- High: **0**
- Medium remaining: **0**
- Low: **6** (BUG-021, BUG-022, BUG-023, BUG-024, BUG-025, BUG-026)

No new BUG IDs from this batch.

### Release recommendation

**NOT FULLY RELEASE-READY**

High = **0** and Medium = **0** after verified browser regression on this batch. The product is **not** fully release-ready. The next phase must still fix/review the Low issues and then run a **fresh Full Regression Audit**. Do not start Milestone 9.

```text
FIX BATCH 4 COMPLETE

Critical: 0
High remaining: 0
Medium remaining: 0
Low: 6 (BUG-021–BUG-026)

BUG-014 / BUG-015 / BUG-016 / BUG-020: FIXED
BUG-029: FIXED (preserved)
BUG-028: FIXED (preserved)
BUG-027: FIXED (preserved)
BUG-009–013, 018, 019: FIXED (preserved)
BUG-007 / BUG-008 / BUG-017: FIXED (preserved)
BUG-004 / BUG-005: FIXED (preserved)
BUG-001 / BUG-002 / BUG-003 / BUG-006: FIXED (preserved)

Automated: 76 files / 469 tests
Release recommendation: NOT FULLY RELEASE-READY (Lows + Full Regression Audit remain)
```

---

# Fix Batch 5 — BUG-021 / BUG-022 / BUG-023 / BUG-024 / BUG-025 / BUG-026

Final known-issue cleanup before a fresh Full Regression Audit. Did **not** start Milestone 9. Did **not** add migrations. Did **not** change billing arithmetic, payment semantics, session-state semantics, Better Auth, or RLS.

## BUG-021 — favicon.ico 404

**Status:** FIXED

**Root cause:** App Router had no `app/favicon.ico`. Browsers still request `GET /favicon.ico` by default, which 404’d.

**Implementation:** Added Next.js App Router `Code/src/app/favicon.ico` (ICO) and a brand-neutral `Code/src/app/icon.svg` (2×2 grid on `#2563eb`). No manufacturer marks. No permanent brand logo.

**Files changed:**

- `Code/src/app/favicon.ico`
- `Code/src/app/icon.svg`
- `Code/tests/ui/bug-021-favicon.test.ts`

**Automated evidence:** ICO exists, ICONDIR type 1, one image; SVG has no PlayStation/Xbox/Nintendo strings. 2 tests PASS.

**Browser evidence:** After a clean `next dev`, `GET /favicon.ico` → **200** `image/x-icon`. `GET /icon.svg` → **200** `image/svg+xml`. Production build lists `/icon.svg` as a static route.

**Remaining risk:** A stale `.next` mixed with `next build` can 404 until the dev server is restarted. Not a product defect.

---

## BUG-022 — public login language switcher

**Status:** FIXED

**Root cause:** `POST /api/ui/locale` called `requireAuthenticated()`. Login/home/setup had ThemeSwitcher only. Unauthenticated users could not choose English before sign-in. Locale is presentation-only (`gc_ui_locale` + `gc_ui_locale_source`).

**Implementation:** Locale POST matches theme: `handleMutation` + Origin CSRF, **no session required**. Does not write `core_organizations.locale`. `LanguageSwitcher` on `/login`, `/`, and `/setup`. Same Arabic-first default when no cookie.

**Files changed:**

- `Code/src/app/api/ui/locale/route.ts`
- `Code/src/app/login/login-form.tsx`
- `Code/src/app/page.tsx`
- `Code/src/app/setup/setup-form.tsx`
- `Code/tests/http/ui-locale.test.ts`

**Automated evidence:** Unauthenticated POST `en`/`ar` → 200 + HttpOnly cookies; invalid locale 400; authenticated POST still 200; route has no `requireAuthenticated`; public surfaces include `LanguageSwitcher`. 7 tests PASS.

**Browser evidence (logged out `/login`):** Arabic → RTL + `تسجيل الدخول`. English → LTR + `Sign in`. Reload keeps English. Switch back to Arabic + reload keeps Arabic (`dir=rtl`, `lang=ar`). `POST /api/ui/locale` **200** without auth. At 390px `scrollWidth === 390` (no horizontal overflow); switcher sits beside theme.

**Auth transition:** Authenticated Owner used the same `/api/ui/locale` switcher on Floor (AR ↔ EN). Public login cookies are independent of the authenticated Playwright session (two browsers). Did not re-type Owner credentials in this batch.

**Remaining risk:** Org-default locale override after login still applies when product rules set `source=org`. User-chosen `source=user` persists as designed.

---

## BUG-023 — guest full-pay notice after PAID

**Status:** FIXED

**Root cause:** Checkout rendered `checkout.guestMustPay` whenever `guestMustPayInFull` was true. That flag is the **rule** (true for all guests, including PAID). UI treated the rule as a remaining-payment warning.

**Implementation:** Presentation helper `guestPayNoticeKind({ guestMustPayInFull, settlementStatus })` → `must_pay` | `paid` | `null`. Unpaid/partial guest → must-pay copy. PAID guest → paid success copy. Customers → no guest notice. Domain `guestMustPayInFull` and `guest_must_pay_in_full` enforcement **unchanged**.

**Files changed:**

- `Code/src/ui/guest-checkout-notice.ts`
- `Code/src/app/admin/gaming/sessions/[sessionId]/checkout/page.tsx`
- `Code/src/i18n/messages/en.ts` (`checkout.guestPaid`)
- `Code/src/i18n/messages/ar.ts` (`checkout.guestPaid`)
- `Code/tests/ui/bug-023-guest-notice.test.ts`
- `Code/tests/finance/checkout.test.ts` (PAID guest still `guestMustPayInFull: true`)

**Automated evidence:** Notice kinds for UNPAID / PARTIALLY_PAID / PAID / customer; AR/EN copy distinct; checkout page uses helper not the raw flag. 3 focused tests PASS. Existing checkout tests still reject guest partial payment.

**Browser evidence:** Unpaid guest checkout: remaining > 0, **فواتير الزائر يجب دفعها كاملة**. Partial 1 SYP → **يجب دفع جلسات الزائر بالكامل** (409), no payment recorded. PAID guest: remaining 0, warning gone, **فاتورة الزائر مدفوعة بالكامل**. Customer PAID: no guest notice. Newly ended guest session `#7` still shows the unpaid instruction (remaining 235 SYP). At 390px the unpaid notice remains visible, no horizontal overflow.

**Remaining risk:** None for this bug. Did not create extra successful payments.

---

## BUG-024 — RTL back arrows

**Status:** FIXED

**Root cause:** Customer/device/area/device-type detail used a physical `←`. Session/checkout already used `IconBack` + `.icon-directional`.

**Implementation:** Shared `BackLink` (`IconBack` + `.back-link`). RTL `html[dir="rtl"] .icon-directional { transform: scaleX(-1) }`. No per-page `←`/`→`.

**Files changed:**

- `Code/src/app/_components/page-ui.tsx` (`BackLink`)
- `Code/src/app/admin/customers/[customerId]/page.tsx`
- `Code/src/app/admin/gaming/devices/[deviceId]/page.tsx`
- `Code/src/app/admin/gaming/areas/[areaId]/page.tsx`
- `Code/src/app/admin/gaming/device-types/[deviceTypeId]/page.tsx`
- `Code/src/app/admin/gaming/sessions/[sessionId]/page.tsx`
- `Code/src/app/admin/gaming/sessions/[sessionId]/checkout/page.tsx`
- `Code/tests/ui/bug-024-back-link.test.ts`

**Automated evidence:** Covered detail routes contain `<BackLink` and no `←`/`→`. 3 tests PASS.

**Browser evidence:** Arabic customer/device/checkout back SVG computed `matrix(-1, 0, 0, 1, 0, 0)`. English LTR transform `none`. Labels **الزبائن** / **الأجهزة** vs **Customers** / **Devices**.

**Remaining risk:** Other pages that never used the physical arrow pattern were out of scope.

---

## BUG-025 — Organization Name marked optional

**Status:** FIXED

**Root cause:** Dashboard Business Profile `name` had `optional: true`. Domain: create `name` required `min(1)`; update `name` if sent must be `min(1)` (cannot blank). Legal name and timezone remain optional.

**Implementation:** Removed `optional: true` from the name field. `ApiForm` still sets HTML `required={!field.optional}`. Backend schemas unchanged.

**Files changed:**

- `Code/src/app/admin/page.tsx`
- `Code/tests/ui/bug-025-org-name.test.ts`

**Automated evidence:** Create without name throws; blank update throws; dashboard name block has no `optional: true`; AR `الاسم` / EN `Name` have no optional marker. 3 tests PASS.

**Browser evidence:** Arabic: **الاسم** without اختياري; legal/timezone still اختياري. English: **Name** vs **Legal name (optional)** / **Timezone (optional)**.

**Remaining risk:** None for this bug.

---

## BUG-026 — Floor End confirmation Overlay

**Status:** FIXED

**Root cause:** Floor End used `ActionButton` + `confirmText`, which nested `ConfirmDialog` inside the tile. `.app-main { overflow: hidden }` clipped it on mobile. Cancel Session already used Overlay (BUG-015). Spec required shared Overlay for End without merging Cancel logic.

**Implementation:** Dedicated `EndSessionControl`: `ConfirmDialog` (alertdialog, Keep Session / Confirm End) via Overlay portaled to `document.body`. Confirm POSTs `/end` then `endedSessionCheckoutHref` + `router.push` (BUG-007). `CancelSessionControl` unchanged (reason + `/cancel`). Overlay `createPortal(document.body)`, Escape, focus restore, scroll lock.

**Files changed:**

- `Code/src/app/admin/gaming/_components/floor-device-actions.tsx`
- `Code/src/app/_components/overlay.tsx` (portal to `document.body`)
- `Code/src/app/_components/confirm-dialog.tsx` (`cancelLabel`)
- `Code/src/i18n/messages/en.ts` / `ar.ts` (`floor.confirmEnd`)
- `Code/tests/ui/bug-026-end-overlay.test.ts`
- `Code/tests/onboarding/bug-007-008-017-wiring.test.ts`

**Automated evidence:** End uses ConfirmDialog Overlay, `/end` only, no `/cancel`, checkout href helper. Overlay has Escape, trap, `aria-modal`, portal. 3 tests PASS.

**Browser evidence:** End → `role="alertdialog"` `aria-modal="true"` titled **إنهاء** / **End**, described, portaled to `body`. Focus lands on Confirm End. Tab wraps last→first; Shift+Tab wraps first→last. Escape closes; focus returns to **إنهاء** / **End**; `body` overflow restored. Keep Session leaves the tile Occupied. Dark: panel `rgb(34, 44, 56)`. Mobile 390: adaptive full-bleed (~358×812). 900/1440: compact 448×160. Confirm End on disposable guest session `01a05429-edd8-7b88-dcac-517574ae0657`: `POST .../end` **200**, no `/cancel`, navigated to `/admin/gaming/sessions/.../checkout` (**التحصيل · #7**). Cancel Session remains a separate control.

**Accessibility/responsive:** Title + description IDs; focus trap; Escape; focus restore; scroll lock; destructive hierarchy is Confirm End vs Keep Session (not danger-red, because End is completion not Cancel). Light/Dark and RTL/LTR verified.

**Remaining risk:** First End attempt during a polluted `.next` (after `next build` while `next dev` ran) returned 500 `Cannot find module './vendor-chunks/@better-auth.js'`. Restarting `next dev` on a clean cache made End **200**. Dev-cache issue, not End logic.

---

### Latest automated verification (this batch)

Ran from `Code/` against the local test database. **Did not** run `npm run test:supabase`. **Did not** mutate hosted Supabase. **Did not** reset PostgreSQL. Migrations **0001–0013** unchanged. Nothing committed, pushed, or deployed.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **82 files / 490 tests passed** |
| `npm run build` | **PASS** (Next.js 15.5.23) |

Fix Batch 4 baseline was 76 files / 469 tests. New/extended: `bug-021-favicon` (2), `ui-locale` (7), `bug-023-guest-notice` (3), `bug-024-back-link` (3), `bug-025-org-name` (3), `bug-026-end-overlay` (3). Prior-batch tests remained green.

### Remaining bug counts

- Critical: **0**
- High: **0**
- Medium remaining: **0**
- Low: **0**

No new BUG IDs from this batch.

### Release recommendation

**KNOWN QA BACKLOG CLEARED**

**NOT FULLY RELEASE READY**

The required next step is a **Fresh Full Regression Audit** of the actual running localhost application. Do not start Milestone 9.

```text
FIX BATCH 5 READY FOR FINAL REGRESSION

Critical: 0
High remaining: 0
Medium remaining: 0
Low: 0

KNOWN QA BACKLOG CLEARED
NOT FULLY RELEASE READY
Next: Fresh Full Regression Audit

BUG-021 / BUG-022 / BUG-023 / BUG-024 / BUG-025 / BUG-026: FIXED
Prior batches: preserved

Automated: 82 files / 490 tests
```

---

# Fresh Full Regression Audit — 2026-08-31

**Audit type:** NEW full regression. Prior PASS results were not treated as proof.  
**Release decision:** **NOT READY**  
**New defects:** BUG-030 … BUG-036  
**Counts from this audit:** Critical **0** · High **2** · Medium **4** · Low **1**  
**Automated suite this session:** **not re-executed** (last recorded Fix Batch 5: 82 files / 490 tests).

> Historical sections 1–25 and Fix Batches 1–5 above are unchanged. This appendix is additive.

---

## Environment

- **HEAD:** `5fe4e63` on `master` (`Add platform bootstrap; gate public signup`). Working tree remains dirty (UX/product pass + QA fixes). Nothing committed or pushed.
- **App:** Next.js **15.5.23** `next dev` at `http://localhost:3000` (terminal already running; verified).
- `GET /api/health/live` → **200** `{status:ok}`
- `GET /api/health/ready` → **200** `{status:ok}`
- `GET /favicon.ico` → **200** `image/x-icon`
- **Runtime DB (mutating tests):** host `127.0.0.1`, database `gaming_center_security_test`, role `gaming_app`. Connected `current_database()` matched. **Not** hosted Supabase. `.env` still contains a hosted URL; Next loaded `.env.local` over it (`Environments: .env.local, .env`). Secrets not printed.
- **Org:** QA Gaming Center · Owner display name Cursor Test · timezone `Asia/Riyadh`
- **Migrations on disk:** `0001`–`0013` present. This audit did not alter them.
- **Milestone 9 / POS:** not started.

## Tools

- Cursor Browser (logged-out public/login/logout, org enter)
- Playwright MCP (authenticated Owner journeys, viewports, overlays)
- Chrome DevTools MCP listed; used Cursor CDP `Runtime.evaluate` + Playwright network/console
- curl for closed-bootstrap POST/GET (no secrets in Location/follow HTML)
- Local `postgres` identity query via temp script outside the repo

Playwright is still not in `package.json`. It was not installed.

## Authorization limitation

Only the existing Owner account was available. Restricted-role / branch-limited staff **NOT FULLY TESTED** in the browser. Automated `route-authorization` tests were **not** re-run this session.

## Routes tested (browser)

`/`, `/login`, `/setup` (HTTP), `/admin`, `/admin/onboarding`, `/admin/branches`, `/admin/gaming/floor`, `/admin/gaming/sessions`, `/admin/gaming/sessions/{id}`, `/admin/gaming/sessions/{id}/checkout`, `/admin/gaming/areas`, `/admin/gaming/device-types` (list walk), `/admin/gaming/devices`, `/admin/gaming/pricing`, `/admin/customers`, `/admin/users`, `/admin/roles`, `/admin/reports`, `/admin/audit`, `/admin/settings`, `/admin/gaming/sessions/not-a-uuid`, `/admin/customers/00000000-0000-0000-0000-000000000000`.

## Viewport / locale / theme matrix

| Viewport | Surfaces |
|---|---|
| 1920×1080 (Cursor) | Public home, login |
| 1440×900 | Admin shell, Floor, checkout, management |
| 900×900 | Tablet hamburger drawer, no bottom nav |
| 390×844 | Bottom nav + More drawer, checkout paid history, settings/users/reports |

| Locale × theme | Evidence |
|---|---|
| AR + Dark | Login, dashboard, Floor, checkout, logout |
| AR + Light | Public home default before theme switch |
| EN + Light | Public home persistence; dashboard/Floor (Playwright) |
| EN + Dark | Playwright org picker / Floor after theme from prior session |

## Test data created this audit

- Branches: **QA-Audit-31-Branch** (two rows — see BUG-035)
- Area: **QA-Audit-31-Area**
- Devices: bulk **QA Device Type - 01** and **-02** on QA-Audit-31-Area
- Customer: **QA-Audit-31-Customer** / `0999000031`
- Sessions: guest **#8** (pause/resume/end, CASH 10 SYP); guest **#9** (move then end, ShamCash 10 SYP, ref `QA-AUDIT-31-SC`)
- Did **not** cancel the leftover occupied guest on **QA Device Type - 01** (~3h playing)
- Did **not** create a second owner / reopen bootstrap

---

## Result by area

### Authentication / security

| Check | Result |
|---|---|
| Public `/` Arabic default, RTL, Sign in, language switcher, favicon | **PASS** |
| AR→EN persist after refresh; switch back AR | **PASS** |
| Login form `method=post` `action=/login` (+ button formMethod/formAction) | **PASS** |
| Empty submit HTML5 required | **PASS** (browser message in English) |
| Malformed email typeMismatch | **PASS** |
| Wrong password → stay `/login`, no query credentials, `POST /api/auth/sign-in/email` **401** | **PASS** (copy: BUG-031) |
| Valid login → `/admin`; Enter/click; loading `جارٍ الدخول…` | **PASS** |
| Unauth `/admin` and nested admin → **307** `/login` | **PASS** |
| Malformed session URL while logged in → “الجلسة غير موجودة.” | **PASS** |
| Authenticated `/` / `/login` | **PASS** (redirected away from public home when session exists) |
| Logout `POST /api/auth/sign-out` **200**, `/login`; refresh; direct `/admin`; history.back | **PASS** (BUG-004) |
| GET `/setup` closed → **303** `/login` | **PASS** |
| GET `/setup?email&password&bootstrapToken` Location `/setup` (no markers) | **PASS** (BUG-028) |
| POST `/setup` closed → **303** `/login`; follow GET `/login`; markers not in HTML | **PASS** (BUG-029) |
| Restricted roles | **NOT FULLY TESTED** |

### Guided Setup

Current org already operational. Dashboard still offers **إنهاء الإعداد الموجّه** / Continue setup while stating the floor can already run — **PASS** vs treating `operationalReady` as hidden completion (BUG-008). `/admin/onboarding`: steps Ready, Staff optional, Previous / Save and continue later, go to Floor. First-run empty-org wizard **PARTIAL** (cannot reconstruct without DB reset).

### Master data / pricing

List/create branch/area/customer/bulk devices **PASS** with QA-prefixed data. Duplicate branch names stored (BUG-035). Branch/area/device-type **table headers and several actions still English** on Arabic pages (BUG-032). Pricing shows **QA Hourly 100** / **100 SYP per hour**; assignment to whole business **ACTIVE**. Zero/negative price **NOT TESTED** this session (avoid mutating live plan). Internal device codes not shown in the devices list. Bulk first submit created two devices with visible type **QA Device Type** (BUG-003 not regressed).

### Gaming Floor / sessions / billing / checkout

| Journey | Result |
|---|---|
| Occupied + free + elapsed display | **PASS** (after selecting QA Branch; default branch hid them — BUG-036) |
| Compact tiles, occupied taller than free (208 vs ~422) | **PASS** |
| Start guest | **FAIL** first click (BUG-033); **PASS** on retry after hydrate/compile (`POST …/sessions` **201**) |
| Pause / Resume | **PASS** (`POST …/pause` **200**, `…/resume` **200**) |
| End overlay trap / Escape / focus restore | **PASS** (BUG-026) |
| End → checkout, no auto-pay | **PASS** (BUG-007) |
| Cancel overlay (reason only inside overlay) | **PASS** (BUG-015); not billed copy; Escape restores **Cancel session** |
| Device 03 available after checkout | **PASS** |
| #8 guest bill 10 SYP (minimum), CASH paid, remaining 0, paid notice | **PASS** (BUG-023) |
| Guest zero (no payment row), partial **409** Arabic, overpay **409** Arabic | **PASS** |
| #9 move &lt;5 min: total **10 SYP** not 20; segments 4+6; “after move” device | **PASS** (BUG-005) |
| ShamCash + reference recorded | **PASS**; hint is staff-recorded |
| EN checkout: Cash/ShamCash, “paid in full” | **PASS** (BUG-011) |
| Pause excluded from money | **PASS** for #8 (unpaid pause 0 on #9; #8 pause was short; calculator not contradicted). Display timer includes wall-clock after resume (display-only). |

### Customers / staff / roles / reports / audit / settings

Customers list/create **PASS**. Duplicate phone allowed (product copy). Staff: two email inputs, distinct ids, label **البريد الإلكتروني**, no `aria-label` (BUG-020). Roles list + English permission catalog (data). Reports: timezone **Asia/Riyadh**, billed vs payments split, move double-count warning; **default branch = first listed empty branch** (BUG-036); after selecting QA Branch: 31 Aug **2 sessions / 20 SYP billed** and CASH 10 + ShamCash 10. Audit actions translated (no dotted keys) including this audit’s create/move/pay. Settings: Name required (BUG-025), legal/timezone optional, no 60-second billing unit, FieldHelp opens/closes Escape, not clipped on the guest-sessions control. Settings still has English blocks (BUG-032).

### i18n / RTL / responsive / a11y / console / performance

RTL desktop sidebar **right** (x≈1161 @1440); EN **left** (x=0). Mobile AR More drawer from **right** (right=390). Tablet 900: hamburger 44px, no bottom nav, drawer from right. 390: no horizontal overflow on dashboard/floor/sessions/customers/reports/settings/users; bottom nav Home/Floor/Sessions/Customers/More. Favicon 200. Console: **ElapsedTimer hydration mismatch** on Floor whenever an active session exists (BUG-030). Next.js issues portal can intercept mobile clicks in **dev**. First-hit API compiles 2–11s (dev); subsequent pause/end/pay hundreds of ms to a few seconds. Not a production load test.

---

### BUG-030 — Floor elapsed timer hydrates with a mismatched clock

**Severity:** Medium  
**Category:** Stability / UI  
**Location:** `/admin/gaming/floor` `ElapsedTimer`  
**Environment:** Playwright, 1440×900 and after Floor reloads; AR and EN; active occupied tile present.  
**Preconditions:** At least one ACTIVE session.  
**Steps:** 1. Open Gaming Floor. 2. Inspect console.  
**Expected:** No hydration mismatch; timer is display-only without remounting the tile.  
**Actual:** `Hydration failed…` `ElapsedTimer` `+02:49:05` vs `-02:49:01` (seconds drift). Tile tree regenerates. Recurs on later Floor loads (e.g. `03:13:54` session).  
**Evidence:** Playwright console; `elapsed-timer.tsx` uses `useState(() => Date.now())` for SSR and client.  
**Regression:** No (not in BUG-001–029 as a numbered hydration defect).  
**Likely cause:** SSR `Date.now()` vs later client hydrate.  
**Suggested fix:** Render a stable placeholder until `useEffect`, or pass server `now` and tick only on the client.  
**DO NOT IMPLEMENT in this audit.**

### BUG-031 — Invalid login error is English on the Arabic login page

**Severity:** Medium  
**Category:** i18n / UX  
**Location:** `/login`  
**Environment:** Cursor Browser, Arabic, Dark.  
**Preconditions:** Logged out.  
**Steps:** 1. Arabic login. 2. Unknown email + wrong password. 3. Submit.  
**Expected:** Localized error.  
**Actual:** Stays on `/login` with **Invalid email or password**. Network `POST /api/auth/sign-in/email` 401, no query credentials.  
**Evidence:** Login form surfaces Better Auth `error.message` unchanged.  
**Regression:** No.  
**Suggested fix:** Map known Better Auth failures to `login.invalidCredentials` in `ar.ts`/`en.ts`.  
**DO NOT IMPLEMENT.**

### BUG-032 — Arabic admin chrome is translated; tables, pricing, and settings still mix English

**Severity:** Medium  
**Category:** i18n / UI  
**Location:** `/admin/branches`, `/admin/gaming/areas`, `/admin/gaming/device-types`, `/admin/gaming/pricing`, `/admin/settings`, roles descriptions  
**Environment:** Playwright Arabic RTL 1440.  
**Preconditions:** Locale `ar`.  
**Steps:** Open those pages.  
**Expected:** Operator chrome (headers, filters, actions, section titles) in Arabic, matching nav.  
**Actual:** Examples: branches `Name` / `Status` / `Open` / `Close` / `Archive` / `Add branch`; pricing `Hourly price` / `Package price` / `Where prices apply` / `Advanced` / `ACTIVE`; settings `Applies to` / `Optional capabilities` / `Point of sale`. Nav and Floor status chips (مشغول/شاغر) are Arabic.  
**Evidence:** Browser snippets; hardcoded `<th>Name</th>` in `branches/page.tsx` and similar.  
**Regression:** Partial leftover of **BUG-006** (page chrome was fixed; these strings were not). Not a return to fully English modules.  
**Suggested fix:** Drive remaining chrome through `t(locale, …)`.  
**DO NOT IMPLEMENT.**

### BUG-033 — Floor Start can native-GET `?customerId=` and not start a session

**Severity:** High  
**Category:** Functional  
**Location:** Gaming Floor → Start (`ApiForm` on available tile)  
**Environment:** Playwright Arabic Floor, 1440×900.  
**Preconditions:** Available device (QA Station - 01).  
**Steps:** 1. Open Floor (occupied timer already on another device). 2. Click **بدء** on a free tile.  
**Expected:** `POST /api/gaming/sessions` and the tile becomes occupied.  
**Actual:** Navigation to `/admin/gaming/floor?customerId=`; tile stayed **شاغر**. Start `<form>` had **no method/action**. Retry later issued `POST /api/gaming/sessions` **201** and started the session.  
**Evidence:** Playwright URL + occupancy; server log `GET /admin/gaming/floor?customerId= 200` then later `POST /api/gaming/sessions 201`; `controls.tsx` `ApiForm` is `onSubmit` + default GET form, same class of issue as BUG-027. Combined with BUG-030 remounts.  
**Regression:** No prior ID (related class to BUG-027).  
**Suggested fix:** Explicit `method="post"` `action` that cannot start a session via GET, plus `preventDefault`; do not serialize customerId onto the Floor URL.  
**DO NOT IMPLEMENT.**

### BUG-034 — Optional fields show both `(optional)` and `(اختياري)`

**Severity:** Low  
**Category:** i18n / UX  
**Location:** Branches create (`Address (optional) (اختياري)`); pricing minimum charge; roles description.  
**Environment:** Playwright Arabic.  
**Expected:** One optional marker in the active locale.  
**Actual:** English `(optional)` plus Arabic FormField optional suffix.  
**Evidence:** Branches labels array.  
**Regression:** No.  
**Suggested fix:** Labels without embedded optional; let `FormField` own the suffix.  
**DO NOT IMPLEMENT.**

### BUG-035 — Creating a branch stored two rows with the same name

**Severity:** Medium  
**Category:** Functional  
**Location:** `/admin/branches`  
**Environment:** Playwright Arabic 1440.  
**Preconditions:** Owner can manage branches.  
**Steps:** Fill `QA-Audit-31-Branch`, submit (Enter then **Add branch**).  
**Expected:** One branch; duplicate name rejected or clearly confirmed.  
**Actual:** Table had **two** `QA-Audit-31-Branch` rows plus original `QA Branch`. Both appear in Floor/Reports/Devices filters.  
**Evidence:** `branchRows: 3`, `branchNames: ["QA-Audit-31-Branch","QA-Audit-31-Branch","QA Branch"]`.  
**Regression:** No.  
**Suggested fix:** Unique name per org; disable submit while in-flight.  
**DO NOT IMPLEMENT.**

### BUG-036 — Floor and Reports branch filters have no “all branches” and default to the first branch

**Severity:** High  
**Category:** Functional / UX  
**Location:** `/admin/gaming/floor` toolbar `branchId`; `/admin/reports` `branchId`  
**Environment:** Playwright after creating QA-Audit-31-Branch.  
**Preconditions:** More than one branch.  
**Steps:** 1. Create a new branch. 2. Open Floor or Reports without changing the filter.  
**Expected:** Default to the current operating branch or an explicit All-branches view; empty state only when that scope is truly empty.  
**Actual:** Floor showed **2** tiles (new branch only); original occupied QA Device Type - 01 vanished until **QA Branch** was selected. Reports defaulted to the new empty branch (`لا جلسات في هذا النطاق`) despite today’s #8/#9 on QA Branch. After forcing QA Branch + range: 31 Aug **2 sessions / 20 SYP** billed and CASH 10 + ShamCash 10. Area/type filters already have All.  
**Evidence:** Floor `select[name=branchId]` options were only the three branches, first selected; Reports same.  
**Regression:** No.  
**Suggested fix:** Add All-branches (or pin last-used/org default branch); never silently select the newest empty branch.  
**DO NOT IMPLEMENT.**

---

## Historical bug regression summary (retested)

| ID | This audit |
|---|---|
| BUG-001 drawer | **PASS** (390 More drawer visible; 900 hamburger) |
| BUG-002 RTL sidebar | **PASS** (AR desktop right; EN left; AR mobile drawer right) |
| BUG-003 bulk deviceTypeId | **PASS** (first bulk submit created two typed devices) |
| BUG-004 logout | **PASS** |
| BUG-005 move minimum | **PASS** (10 SYP not 20) |
| BUG-006 Arabic modules | **PARTIAL leftover** → BUG-032 (nav/Floor/checkout Arabic; tables/settings English) |
| BUG-007 End→checkout | **PASS** |
| BUG-008 wizard vs operationalReady | **PASS** (dashboard still offers finish/continue) |
| BUG-009/010/011 localized checkout | **PASS** for payment errors and نقد/شام كاش / Cash/ShamCash |
| BUG-012 audit keys | **PASS** |
| BUG-014 FieldHelp | **PASS** (guest-sessions help; Escape; not clipped) |
| BUG-015 Cancel overlay | **PASS** |
| BUG-016 mobile overlap | **PASS** on sampled 390 pages (no overflow; paid checkout cards) |
| BUG-020 names | **PASS** (checkout amount textbox المبلغ; Floor customer label; staff emails distinct ids) |
| BUG-021 favicon | **PASS** 200 |
| BUG-022 public language switcher | **PASS** |
| BUG-023 guest paid notice | **PASS** |
| BUG-024 RTL back | **PASS** (`matrix(-1, 0, 0, 1, 0, 0)` on session detail) |
| BUG-025 org name required | **PASS** |
| BUG-026 End overlay | **PASS** |
| BUG-027/028/029 form GET / setup 303 | **PASS** on login markup and setup HTTP |

---

## Automated baseline

This fresh audit **did not** run `npm test`, `typecheck`, `lint`, or `build`. It **did not** run `test:supabase` or `test:postgres`. Last recorded suite remains Fix Batch 5: **82 files / 490 tests PASS**. Browser evidence is the source of this release decision.

## Quality scores

| Area | Score | Reason |
|---|---:|---|
| Functionality | 6/10 | Billing/checkout/move work; Start GET and branch-default filters break operators |
| UI | 7/10 | Shell, density, overlays, dark RTL login are consistent |
| UX | 6/10 | Empty Floor/Reports after a new branch; first Start can no-op |
| Responsive Design | 8/10 | 390/900/1440 sides and overflow checks held |
| Accessibility | 7/10 | Overlays trap; hydration remount; English native/login errors |
| Performance | 6/10 | Dev compile waterfalls; no production profile |
| Stability | 6/10 | Timer hydration on Floor with any active session |
| Security | 8/10 | Logout/setup/unauth held; role matrix not browser-tested |
| i18n | 6/10 | Strong nav/Floor/checkout AR; leftover English chrome |

## Release decision

**NOT READY**

## Recommended next action

P0: BUG-033, BUG-036. P1: BUG-030, BUG-031, BUG-032. P2: BUG-035. P3: BUG-034. Then re-run this audit. Do not start Milestone 9. Do not treat 490 tests as a freeze.

## Safety confirmation

- No source code modified  
- No fixes implemented  
- No hosted DB mutation  
- No `test:supabase`  
- No DB reset  
- Migrations 0001–0013 preserved  
- Nothing committed / pushed / deployed  
- Milestone 9 not started  

---

# Fresh Regression Fix P0 — BUG-033 / BUG-036

**Date:** 2026-08-31  
**Scope:** High findings from [Fresh Full Regression Audit — 2026-08-31](#fresh-full-regression-audit--2026-08-31) only.  
**Did not implement:** BUG-030, BUG-031, BUG-032, BUG-034, BUG-035.  
**Did not start Milestone 9.** Did not add migrations. Did not change billing arithmetic, payment semantics, Better Auth, or RLS.

**Automated suite this session:** `npm run typecheck` PASS · `npm run lint` PASS · `npm test` **86 files / 515 tests PASS** · `npm run build` PASS. Did **not** run `test:supabase`.

**Remaining Fresh counts after this P0:** Critical **0** · High **0** · Medium **4** (BUG-030, BUG-031, BUG-032, BUG-035) · Low **1** (BUG-034).

**Release recommendation:** **NOT READY.** Do **not** declare Release Candidate. Next required work is the remaining Fresh Regression findings, then a targeted/fresh regression confirmation.

> The Fresh Full Regression findings above are unchanged historical evidence. This appendix records the P0 fixes only.

---

## BUG-033 — Floor Start native GET `?customerId=`

**Status:** FIXED

**Root cause:** Floor Start used `ApiForm` with a client `onSubmit` + `preventDefault`, but the HTML `<form>` had **no `method`/`action`**. HTML default is GET, so a pre-hydration or failed-handler click serialized `customerId` onto `/admin/gaming/floor?customerId=` and never called `POST /api/gaming/sessions`. Same class as BUG-027. Canonical start remains JSON `POST /api/gaming/sessions` (`parseJsonBody`); form-urlencoded cannot start a session.

**Implementation:** Floor Start is a client operational interaction. No-JS **fails closed** (does not start a session). Native submit is `method="post"` to the Floor page (never GET). Middleware **303 See Other** for `application/x-www-form-urlencoded` POST to `/admin/gaming/floor` (JSON Start API is not intercepted). `GET ?customerId=` is stripped by RSC redirect; `branchId` / `areaId` / `deviceTypeId` are preserved. `deviceId` is JSON `extraBody`, not a named GET field. Duplicate clicks: `inFlight` ref + busy disable; server still 409s a second start on the same device.

**Files changed:**

- `Code/src/ui/floor-start-form-safety.ts` (new)
- `Code/src/app/admin/_components/controls.tsx` (`ApiForm` method/action, `inFlight`, optional native action)
- `Code/src/app/admin/gaming/_components/floor-device-actions.tsx`
- `Code/src/app/admin/gaming/floor/page.tsx` (leak-query redirect; native action with `branchId`)
- `Code/src/middleware.ts`
- `Code/src/i18n/messages/en.ts` / `ar.ts` (`floor.javascriptRequired`)
- `Code/tests/ui/floor-start-form-safety.test.ts` (new)
- `Code/tests/http/floor-start-bug-033.test.ts` (new)

**Automated evidence:** Start form cannot default to GET; native POST navigation URL has no `customerId`; leak-query redirect strips Start keys; middleware 303 Location has no `customerId` and does not intercept JSON; urlencoded POST to Start API does not create a session; hydrated guest JSON Start **201**; hydrated customer JSON Start **201**; duplicate start **409**; maintenance/unavailable **409**. Focused tests in the two new files plus existing session/authorization suite still green.

**Browser evidence (`http://localhost:3000/admin/gaming/floor`, QA Gaming Center, Playwright):** Start `<form method="post" action="/admin/gaming/floor?branchId=…">` with `formMethod`/`formAction` post; named field `customerId` only. Guest Start on **QA Device Type - 01**: session started on first click; tile occupied. Customer Start (**QA-Audit-31-Customer**) on **QA Device Type - 02**: session started; no `customerId` query navigation. Direct `GET /admin/gaming/floor?customerId=` redirected to `/admin/gaming/floor` with `hasCustomer: false`. Arabic Floor after locale switch still `method=post`.

**Network evidence:** Hydrated Start → **POST `/api/gaming/sessions` 201**. No `GET /admin/gaming/floor?customerId=`. Native urlencoded POST to Floor → **303** `Location: /admin/gaming/floor?branchId=…` (Start field stripped). Subsequent Floor RSC GET had no `customerId`.

**Remaining risks:** Enter-key native submit was not clicked in the browser; markup + middleware 303 cover it. Duplicate-click UI was not double-clicked in the browser; `inFlight` + HTTP 409 are tested. BUG-030 timer remounts can still interrupt a click visually, but they can no longer GET-serialize Start fields. Two occupied sessions were left on Audit-31 devices 01 and 02 from this verification (guest + customer). `ApiForm` defaults native POST to the JSON `action` URL for other callers (fail-closed); only Floor Start overrides native action to the Floor page.

---

## BUG-036 — Branch filter / default selection hides Floor and Reports data

**Status:** FIXED

**Root cause:** Floor and Reports used `branches[0]` after `listSessionBranches` **`orderBy(coreBranches.code)`**. Auto-codes / newly created empty branches sorted first. There was no persisted operational-branch cookie. Floor is one concrete branch (`listFloor` requires `branchId`). Reports API previously **required** `branchId`, so there was no organization-wide default.

**Floor semantics:** Operational workspace — **one concrete branch**. No “All branches” Floor grid (would make Start/Pause/End ambiguous). Default: (1) valid explicit `branchId` in the URL if the actor can VIEW it; (2) first accessible branch that has non-archived devices, in the caller’s stable list order; (3) first accessible branch. Explicit empty-branch selection is preserved. Stale/inaccessible ids are treated as missing (not selected). Empty state names **that** branch (`floor.emptyBranch`).

**Reports semantics:** Backend now treats omitted `branchId` as all VIEW-granted branches (`inArray`). UI default is **All branches** / **كل الفروع**. Explicit valid `branchId` filters that branch. Stale/inaccessible ids fall back to All, not another branch. Empty branch copy names that branch (`reports.noSessionsInBranch` + `reports.scopeBranch`). Authorization still `requireBranchAccess` for an explicit id; VIEW grants still bound org-wide totals. No fake totals if the actor has no VIEW grants.

**URL / query:** Floor and Reports remain GET filters. Refresh and Back/Forward keep `branchId` when present. Floor leak keys (`customerId`) are not branch keys.

**Files changed:**

- `Code/src/modules/gaming/branch-selection.ts` (new)
- `Code/src/modules/gaming/floor.ts` (`listBranchIdsWithFloorDevices`)
- `Code/src/modules/gaming/index.ts`
- `Code/src/app/admin/gaming/floor/page.tsx`
- `Code/src/modules/reports/reports.ts` (optional `branchId`; `PilotOperationsReport.branchId: string | null`)
- `Code/src/app/api/reports/route.ts`
- `Code/src/app/admin/reports/page.tsx`
- `Code/src/i18n/messages/en.ts` / `ar.ts` (`floor.emptyBranch`, `reports.allBranches`, `reports.scopeAll`, `reports.scopeBranch`, `reports.noSessionsInBranch`)
- `Code/tests/ui/branch-selection.test.ts` (new)
- `Code/tests/gaming/floor-branch-default.test.ts` (new)
- `Code/tests/reports/reports.test.ts` (org-wide omit, empty branch, limited VIEW, no cross-org)
- `Code/tests/http/floor-start-bug-033.test.ts` (reports GET without `branchId`)

**Automated evidence:** Floor default skips an empty code-sorted branch when another accessible branch has devices; explicit empty `branchId` is preserved; stale/inaccessible ids are not selected; `listBranchIdsWithFloorDevices` respects VIEW. Reports omit `branchId` = org-wide VIEW totals; explicit branch filter; empty branch does not imply org-empty; Arabic **كل الفروع** / English **All branches**; unauthorized branch still rejected. Existing tenant/authorization tests remain green.

**Browser evidence (QA Gaming Center, multiple branches including duplicate empty Audit-31 names — BUG-035 not fixed):** Floor with no query selected the first **Audit-31** branch that **has devices** (2 tiles), not the empty duplicate. **QA Branch** still shows 6 tiles when selected (data not gone). Empty duplicate: **No devices at QA-Audit-31-Branch.** Refresh keeps that empty branch. Back returns QA Branch data; Forward returns the empty branch. Reports default **All branches** with hint “Totals include every branch you can view.” Org totals on 31 Aug included sessions across branches. QA Branch: 31 Aug **2 sessions / 20 SYP** billed. Empty Audit branch: **No sessions in QA-Audit-31-Branch for this range.** + “Showing QA-Audit-31-Branch only.” Switch back All restores org totals. Arabic: `كل الفروع`, `التقارير`, `المجاميع تشمل كل فرع يمكنك عرضه.`, `dir=rtl`.

**Network evidence:** Reports GET without `branchId` returns org-wide payload (`branchId: null`). Floor RSC after Start had no `customerId`. Native Floor POST 303 preserved `branchId` only.

**Remaining risks:** Among branches that **all have devices**, the no-query Floor default follows list order (code), not last-used persistence. After this audit’s bulk devices, an Audit-31 branch with devices can be the no-query Floor instead of QA Branch — operators still select QA Branch from the filter; empty newest branches no longer hide the floor. Dashboard still uses `branches[0]` (out of P0 scope). Duplicate branch **names** remain (BUG-035). Restricted-role / branch-limited staff were not re-browser-tested; automated VIEW/access tests cover the query path.

---

## Historical regression protection

This session’s `npm test` **86 / 515 PASS** includes prior batches: BUG-004 logout, BUG-005 MOVE billing, BUG-007 End → Checkout, BUG-027 login form safety, BUG-028/029 setup form safety, plus Guided Setup, localization, Reports timezone, and Floor overlay tests already in the suite. Browser this session reconfirmed Floor Start POST, branch filters, Arabic Reports labels, and `GET ?customerId=` strip. Did not re-walk every historical browser journey.

## Safety confirmation (this P0)

- No hosted DB mutation  
- No `test:supabase`  
- No DB reset  
- Migrations **0001–0013** preserved (no new migration)  
- Nothing committed / pushed / deployed  
- No unrelated Fresh bug fixes  
- Milestone 9 not started  

---

# Fresh Regression Fix P1 — BUG-030 / BUG-031 / BUG-032

**Date:** 2026-08-31  
**Scope:** Medium findings from [Fresh Full Regression Audit — 2026-08-31](#fresh-full-regression-audit--2026-08-31) only: BUG-030, BUG-031, BUG-032.  
**Did not implement:** BUG-034, BUG-035.  
**Did not start Milestone 9.** Did not add migrations. Did not change billing arithmetic, session accounting, Better Auth architecture, authorization, or RLS.

**Automated suite this session:** `npm run typecheck` PASS · `npm run lint` PASS · `npm test` **89 files / 526 tests PASS**. `npm run build` PASS earlier in this P1 conversation with a **single** process (33 pages). After that build, login-form was tightened so a stored failure remaps when locale changes; that delta was typechecked, linted, and covered by the 526-test run. A second production build was **not** started while `next dev` held `.next` (same Windows rename race noted in P0). Did **not** run `test:supabase`.

**Remaining Fresh counts after this P1:** Critical **0** · High **0** · Medium **1** (BUG-035) · Low **1** (BUG-034).

**Release recommendation:** **NOT READY.** Do **not** declare Release Candidate. Next: product decision on BUG-035, cleanup BUG-034, then targeted regression.

> The Fresh Full Regression findings above are unchanged historical evidence. This appendix records the P1 fixes only.

---

## BUG-030 — Floor live timer hydration mismatch

**Status:** FIXED

**Root cause:** `ElapsedTimer` initialized with `useState(() => Date.now())`. SSR `Date.now()` and the first client hydrate `Date.now()` differed, so React reconciled elapsed text (example from Fresh QA: `+02:49:05` vs `-02:49:01`). Presentation only; billing uses server timestamps and the billing calculator.

**Implementation:** Shared helper `formatElapsedDisplay` / `elapsedTimerShouldTick` in `elapsed-display.ts`. Floor RSC takes one `floorNowMs = Date.now()` per request and passes it as `initialNowMs`. Client `useState(props.initialNowMs)` so SSR and the first client paint match. `setInterval` starts in `useEffect` only when status is `ACTIVE`. Paused sessions freeze at `currentPauseStartedAtMs`. No `suppressHydrationWarning`. Session detail uses the same timer with `initialNowMs={Date.now()}`.

**Files changed:**

- `Code/src/ui/elapsed-display.ts` (new)
- `Code/src/app/admin/gaming/_components/elapsed-timer.tsx`
- `Code/src/app/admin/gaming/floor/page.tsx`
- `Code/src/app/admin/gaming/sessions/[sessionId]/page.tsx`
- `Code/tests/ui/elapsed-display.test.ts` (new)

**Tests:** Deterministic SSR/first-client clock string; tick only when `nowMs` advances after mount; paused freeze despite later `nowMs`; `elapsedTimerShouldTick` false for PAUSED/COMPLETED. Billing tests (including MOVE / PRORATED_HOUR / pause exclusion) unchanged and still green.

**Browser evidence (`http://localhost:3000/admin/gaming/floor`, QA Gaming Center, Playwright):** Arabic Floor heading **صالة الألعاب**. Two occupied timers `00:45:42` / `00:45:12` advanced to `00:45:44` / `00:45:14`. Reload showed `00:45:47` / `00:45:17` with no remount flash. Pause on one tile: elapsed **froze** at `00:47:32` for ≥2s while the other ACTIVE tile continued (`00:48:10` → `00:48:13`). Resume was clicked (Resume buttons present); 1.2s later values had not yet advanced (RSC status refresh not waited). Move was **not** re-walked after sign-out for BUG-031.

**Console/Network evidence:** No hydration / `ElapsedTimer` / “did not match” console hits on Floor load or refresh. No billing API calls from the timer (display-only).

**Remaining risks:** MOVE timer presentation was not clicked in this browser pass (same `ElapsedTimer` + server `startedAt`; MOVE billing tests remain green). Resume tick after Pause was not visually confirmed beyond the button click. One Pause left a session paused on the QA floor.

---

## BUG-031 — Arabic login invalid-credentials English copy

**Status:** FIXED

**Root cause:** Hydrated `LoginForm` rendered Better Auth `payload.error.message` / `payload.message` (`"Invalid email or password"`). BUG-009 `displayApiError` was not used on the public login path. Arabic catalog/chrome could be correct while the error stayed English.

**Implementation:** Presentation mapper `displayLoginError` maps stable codes `INVALID_EMAIL_OR_PASSWORD` | `INVALID_PASSWORD` | `USER_NOT_FOUND` | `INVALID_EMAIL`, and HTTP 401/403, to `login.invalidCredentials`. Unknown non-401 uses `login.failed` with status. Raw provider text, stacks, and SQL are not shown. LoginForm stores the failure shape and **derives** the visible string from the current `useLocale()`, so a language switch remaps an existing error. Native POST `/login` (BUG-027) unchanged. Authentication semantics unchanged.

**Files changed:**

- `Code/src/i18n/login-error.ts` (new)
- `Code/src/app/login/login-form.tsx`
- `Code/src/i18n/messages/en.ts` / `ar.ts` (`login.invalidCredentials`, `login.failed`)
- `Code/tests/i18n/bug-031-login-error.test.ts` (new)
- `Code/tests/http/login-error-bug-031.test.ts` (new; real Better Auth 401 payload)

**Tests:** AR/EN catalog mapping; nested `error.code`; 401 without code; unknown 500 does not leak SQL/stack; locale switch remaps the same stored failure; HTTP 401 from Better Auth maps through `displayLoginError`. Existing BUG-027 form-safety and valid JSON sign-in tests remain green. BUG-004 sign-out tests remain in the suite.

**Browser evidence (logged out, Playwright):** Arabic `/login` (waited for heading **تسجيل الدخول**) + wrong password → **البريد الإلكتروني أو كلمة المرور غير صحيحة**; body did **not** contain `Invalid email or password`. Switching to English remapped the same failure to **Invalid email or password** with heading **Sign in**. Second EN submit also 401. Final URL `http://localhost:3000/login` with empty query (no credentials in the address). Valid Owner login was **not** repeated in the browser after sign-out (no password in this session); HTTP suite still signs in with JSON POST.

**Console/Network evidence:** `POST /api/auth/sign-in/email` **401** (twice). Request URL has no query credentials. No new application console errors attributed to the mapper.

**Remaining risks:** Browser valid-login after this sign-out was not repeated. `LanguageSwitcher` still sets `document.documentElement.lang` before `router.refresh()`; waiting on `html.lang` alone can race (tests/browser now wait for the `h1` catalog string).

---

## BUG-032 — Leftover English admin chrome in Arabic

**Status:** FIXED (UI chrome in the audited owner-facing admin routes)

**Root cause:** Page titles were already i18n (BUG-006), but tables, actions, pricing section headings, settings source/capability chrome, assignment Advanced/Priority, setup-checklist step labels, setting-editor Yes/No/Reset, and some AccessDenied fallbacks still used hardcoded English.

**Implementation:** Catalog keys in both `en.ts` / `ar.ts` with existing `t()` / `getRequestLocale()`. Display helpers: `branchStatusLabel`, `recordLifecycleLabel`, `settingSourceLabel`, `pricingPlanAmountLabel` (UI only; does not change `pricing-adapter` billing copy). Setup checklist maps step **ids** to `onboarding.status*` keys instead of English labels from `status.ts`. Permission catalog names and stored role name **Owner** were left as stored/domain data.

**Routes/components corrected (chrome):**

- `/admin/branches` — table headers, Open/Close/Archive, add-branch
- `/admin/gaming/areas` and area detail — headers, add/archive, AccessDenied titles
- `/admin/gaming/device-types` and type detail — headers, category, add/archive
- `/admin/gaming/devices/[deviceId]` — AccessDenied / not-found chrome
- `/admin/gaming/pricing` — Hourly/Package/Where prices apply, deactivate, amount labels
- `/admin/gaming/_components/assignment-form.tsx` — Advanced/Priority
- `/admin/settings` + `setting-editor.tsx` — Applies to, Optional capabilities, Yes/No/Reset
- `/admin` setup checklist — step labels via i18n ids
- Shared: `Code/src/app/_lib/display.ts`

**Examples of hardcoded chrome removed:** `<th>Name</th>`, Add branch/area/type, Hourly price / Package price / Where prices apply, Applies to, Optional capabilities, Advanced, Yes/No/Reset, setup-checklist English step labels, `per hour` in the pricing **UI** label.

**Stored/domain English intentionally preserved:** Owner (built-in role name), QA Branch, QA Device Type, QA Hourly 100, Cursor Test, user-entered names, permission catalog identifiers. Domain `onboarding/status.ts` still has English `label` fields; the UI no longer displays those strings.

**Tests:** `tests/i18n/bug-006-chrome.test.ts` extended for remaining master-data chrome and timer/login wiring; `tests/i18n/locale.test.ts` catalog parity plus BUG-031/032 keys. Static audit asserts absence of specific hardcoded headings/headers, not a ban on all English in source.

**Browser evidence (Arabic 1440):** Dashboard, Branches, Areas, Device types, Devices, Pricing, Floor, Sessions, Customers, Staff, Roles, Reports, Audit, Settings. Headings/table columns/actions Arabic as intended (e.g. الفروع / الاسم / الحالة / إغلاق / أرشفة / إضافة فرع; الأسعار / سعر الساعة / سعر الباقة / أين تُطبَّق الأسعار; الإعدادات / الخيارات / قدرات اختيارية). Language switcher still offers **EN** as a control, not table chrome. Users “منح عرض” is localized VIEW grant. Duration chips “30 د” / “ساعة”.

**English 1440:** Branches `h1` + Name/Status; Pricing Hourly price / Where prices apply / `per hour` true; Settings Appearance / Timezone / Options / Optional capabilities; `lang=en` `dir=ltr`.

**Responsive sanity:** Arabic 390×844 Branches: `scrollWidth=390`, `dir=rtl`, no horizontal overflow. English 390×844 Pricing: `scrollWidth=390`, `dir=ltr`, `h1` Pricing, no horizontal overflow. No full responsive redesign.

**Console/Network:** Locale POST `/api/ui/locale` as before. No new console errors from chrome strings.

**Remaining risks:** Feature-flag / permission **descriptions** stored in English in configuration data were not rewritten. Duplicate branch **names** in filters still look identical (BUG-035). Mixed `(optional)` / `(اختياري)` (BUG-034) was not cleaned globally.

---

## BUG-035 — product decision needed (not implemented)

Inspected only. **No uniqueness change.**

- **Is Branch name unique by schema?** **No.** Unique constraints are `(organization_id, code)` (`core_branches_org_code_key`) and `(id, organization_id)`. `name` has no unique index.
- **Is duplicate name prohibited by a documented product rule?** **No.** FUN-002 requires a unique **code** per organization, not a unique name. `createBranch` has no name-uniqueness check.
- **Would enforcing uniqueness require migration/data cleanup?** **Yes.** A new unique index on `(organization_id, name)` (or a chosen normalization) plus cleanup of existing duplicates (Fresh QA already created two `QA-Audit-31-Branch` rows).
- **What identifier does the UI use to disambiguate?** `branch.id` (option `value`, URLs, filters). Operators currently see **name** only in the label, so duplicates are visually ambiguous.

Possible valid business cases exist for duplicate display names. Do not invent uniqueness in a QA cleanup.

---

## Historical regression protection

This session’s `npm test` **89 / 526 PASS** includes prior batches: BUG-004 logout, BUG-005 MOVE billing, BUG-007 End → Checkout, BUG-009 error localization, BUG-010 durations, BUG-011 payment labels, BUG-012 audit labels, BUG-018 report timezone, BUG-027/028/029 auth/setup form safety, BUG-033 Floor Start safety, BUG-036 branch behavior. Browser this session reconfirmed Floor timer (no hydration warning), Pause freeze, Arabic/English leftover chrome, and localized login errors. Did not re-walk every historical browser journey (valid login, MOVE click, checkout).

## Safety confirmation (this P1)

- No hosted DB mutation  
- No `test:supabase`  
- No DB reset  
- Migrations **0001–0013** preserved (no new migration)  
- Nothing committed / pushed / deployed  
- BUG-035 not modified  
- BUG-034 not modified as a batch (global mixed-optional cleanup not done)  
- Milestone 9 not started  

---

# Fresh Regression Fix P2 — BUG-034 / BUG-035

**Date:** 2026-08-31  
**Scope:** Remaining Fresh findings from [Fresh Full Regression Audit — 2026-08-31](#fresh-full-regression-audit--2026-08-31) only: Medium **BUG-035**, Low **BUG-034**.  
**Did not start Milestone 9.** Did not rewrite migrations 0001–0013. Did not change billing arithmetic, payment semantics, Better Auth, RLS, or BUG-036 selection rules.

**Approved product decision (BUG-035):** A Branch’s human-facing **name** must be unique within the same Organization. Same name across different Organizations remains valid. Internal **codes** stay unique separately (`core_branches_org_code_key`) and are not the operator-facing identifier.

**Automated suite this session:** `npm run typecheck` PASS · `npm run lint` PASS · `npm test` **92 files / 543 tests PASS** · `npm run build` PASS (clean production build of the current tree, including the P1 login-form locale derivation). Did **not** run `test:supabase`.

**Remaining Fresh counts after this P2:** Critical **0** · High **0** · Medium **0** · Low **0**.

**Release recommendation:** **NOT READY** for Release Candidate. Fresh known backlog is cleared. Next required step: **targeted final regression** plus automated final validation. Local migration **0014** is in the tree and proven on PGlite; it is **not** yet applied to local PostgreSQL `gaming_center_security_test` (see Migration below).

> The Fresh Full Regression findings and P0/P1 appendices above are unchanged historical evidence. This appendix records the P2 fixes only.

---

## BUG-035 — Duplicate Branch names in one organization

**Status:** FIXED (application + migration file; local Postgres unique index **not yet applied**)

**Approved domain rule:** Within one organization, duplicate visible names are rejected, including whitespace-only differences after trim and Latin case-equivalent names (`Jaramana` / `jaramana`). Different organizations may share the same name (for example both may have `Main`).

**Old schema behavior:** `core_branches` uniqueness was `(organization_id, code)` and `(id, organization_id)` only. `name` had no unique index. `createBranch` trimmed via Zod but did not conflict on an existing visible name. Fresh QA stored two rows named `QA-Audit-31-Branch`.

**Normalization:** PostgreSQL `lower(btrim(name))`. Names are stored trimmed (Zod `trim()` on create/update; migration 0014 also `UPDATE … SET name = btrim(name)` before the index). No custom Unicode mapping. Arabic has no case; trim still applies. Internal multi-space is **not** collapsed.

**Archive / reuse decision:** Uniqueness includes **ACTIVE, INACTIVE, and ARCHIVED**. Archived branches remain on the Branches admin list and in Reports/history selectors; Floor already filters archived. Reuse of an archived visible name is not allowed unless that row is renamed first. This matches the release-safe preference that visible names stay unambiguous in historical/admin selectors. No product conflict required a weaker “reuse after archive” rule.

**Application validation:** `createBranch` / `updateBranch` lock `core_organizations` `FOR UPDATE`, then reject when another row in the same org matches `lower(btrim(name))`. Stable API reason `branch_name_in_use` (BUG-009 mapping). Unique-violation fallback maps the 0014 index (and any non-code unique) to the same reason so PostgreSQL errors are not shown. Branch **code** uniqueness is unchanged (`core_branches_org_code_key` retries / code conflict message).

**DB enforcement:** Additive migration `Code/drizzle/0014_branch_name_uniqueness.sql` creates unique index `core_branches_org_name_normalized_key` on `(organization_id, lower(btrim(name)))`. Tenant-scoped. IDs, codes, and history are not rewritten. Fail-closed `DO $$` lists remaining duplicates before `CREATE INDEX`. Drizzle `schema.ts` mirrors the expression index.

**Migration 0014 local application:** **Not applied** to local `gaming_center_security_test`. `schema_migrations` still ends at `0013_prorated_hour_billing.sql`. `gaming_app` cannot `CREATE INDEX` on `core_branches` (owner is `gaming_test_migrator`; error 42501). `MIGRATION_DATABASE_URL` is unset. Connecting as `gaming_test_migrator` / `postgres` with the runtime password fails (28P01). `pg_ctl reload` as the desktop user is **Operation not permitted** (service runs as Network Service). Hosted Supabase was **not** targeted. PGlite `tests/db/migrations.test.ts` applies 0014 and proves same-org reject, archived case, cross-org allow, SQL race, and code uniqueness.

**Existing duplicate cleanup (local QA only):** Later row `01a054d1-bd54-769d-6ace-4075846ef3ec` was renamed via tenant-scoped `UPDATE` (same org GUC; IDs/codes kept) from `QA-Audit-31-Branch` to **`QA-Audit-31-Branch-2`**. Earlier row `01a054d0-fc92-7aa9-9e2a-60e6e630b889` kept `QA-Audit-31-Branch`. No hosted cleanup. No other duplicate set was visible in this org.

**Create result:** Same-org exact / trim / Latin-case duplicates → `ConflictError` `branch_name_in_use`, no second row. Browser Arabic create of `QA-P2-035-Unique` succeeded (later uniquely renamed). Exact duplicate → **يوجد فرع بهذا الاسم في هذا النشاط**. Whitespace and `qa-p2-035-unique` → same Arabic message. English duplicate → **A branch with this name already exists in this organization**. No SQL/constraint names in the UI.

**Rename result:** Renaming `QA-Audit-31-Branch-2` to `QA-Audit-31-Branch` rejected; both names remained. Unique rename `QA-P2-035-Unique` → `QA-P2-035-Renamed` succeeded (same id).

**Concurrency result:** Module test `Promise.allSettled` two `createBranch` with the same name: one fulfilled, one `branch_name_in_use`. Migration test concurrent SQL inserts: one fulfilled, one unique-index reject (PGlite). Organization row lock serializes same-org name changes on the application path even before 0014 is applied to local Postgres.

**Cross-org result:** Automated: Org A `Main` and Org B `Main` both succeed. Uniqueness is never global.

**AR/EN browser:** Arabic conflict copy as above; English conflict copy as above. Floor and Reports option labels are distinct (`QA-Audit-31-Branch`, `QA-Audit-31-Branch-2`, `QA Branch`, `QA-P2-035-Renamed`).

**BUG-036 regression (quick):** Floor `GET /admin/gaming/floor` with **no** `branchId` still selected a branch that has devices (`QA-Audit-31-Branch-2`, occupied tiles). Reports default **All branches** / **كل الفروع** (`branchId` empty) with “Totals include every branch you can view.” Explicit empty branch `QA-P2-035-Renamed`: Floor **No devices at QA-P2-035-Renamed.** Reports **لا جلسات في QA-P2-035-Renamed لهذا النطاق.** + **عرض QA-P2-035-Renamed فقط.** Selection rules were not changed.

**Files / tests:**

- `Code/drizzle/0014_branch_name_uniqueness.sql` (new)
- `Code/src/db/schema.ts`
- `Code/src/modules/identity/branches.ts` (`BRANCH_NAME_IN_USE_REASON`, org lock, name check)
- `Code/src/modules/identity/index.ts`
- `Code/src/core/errors.ts` (`uniqueConstraintText` / `uniqueViolationMentions`)
- `Code/src/i18n/api-error.ts` + `en.ts` / `ar.ts` (`apiError.branchNameInUse`, `branches.saveName`)
- `Code/src/app/admin/branches/branch-rename-form.tsx` (new)
- `Code/src/app/admin/branches/page.tsx`
- `Code/tests/identity/branches-name.test.ts` (new)
- `Code/tests/http/branches-bug-035.test.ts` (new)
- `Code/tests/db/migrations.test.ts` (0014)
- `Code/tests/helpers/gaming.ts` (second same-org seed uses a distinct visible name when `branchCode` is set)
- `Code/tests/i18n/bug-009-api-error.test.ts` / `locale.test.ts`

---

## BUG-034 — Mixed `(optional) (اختياري)`

**Status:** FIXED

**Root cause:** Catalog strings (and some form labels) already contained English `(optional)` while `FormField` always appends `({t("common.optional")})` in the active locale. Arabic UI therefore showed **(optional) (اختياري)**.

**Corrected optional semantics:** `FormField` is the only optional marker (`common.optional` → EN `optional` / AR `اختياري`, once). Catalog labels used with `optional` no longer embed the marker (`ui/optional-label.ts` helper + catalog scan). Required labels are unchanged. Customer create/edit and bulk device prefix use FormField optional instead of `*Optional` catalog keys that previously duplicated the suffix.

**Accessible-name result:** Representative labels are a single locale marker (`العنوان (اختياري)`, `Address (optional)`, `الاسم القانوني (اختياري)`, `Legal name (optional)`, `الزبون (اختياري)`, `Customer (optional)`, `Description (optional)`, `Phone (optional)`). No `(optional) (اختياري)` on Branches, Dashboard, Floor, Reports, Roles, Customers, Pricing. Occupied Floor “Attach customer” remains a required **Customer** / **الزبون** without optional. Paid checkout had no remaining optional reference field (bill already settled); pricing **Minimum charge (optional)** and checkout catalog `checkout.reference` are covered by unit tests.

**AR result:** One اختياري per optional FormField.  
**EN result:** One optional per optional FormField.

**Files / tests:**

- `Code/src/ui/optional-label.ts` (new)
- `Code/src/app/_components/form-field.tsx` (unchanged owner of the marker)
- `Code/src/i18n/messages/en.ts` / `ar.ts` (embedded optional stripped from FormField labels)
- `Code/src/app/admin/_components/customer-create-form.tsx` and customer edit / bulk device / roles callers
- `Code/tests/ui/optional-label.test.ts` (new)

---

## Validation (this P2)

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **92 files / 543 tests PASS** |
| `npm run build` | PASS (Next.js 15.5.23, current tree including P1 login-form `useLocale`) |

Browser: `http://localhost:3000` after that build, via **`npm run dev`** (see BUG-037). Production `next start` did not serve this local DATABASE_URL.

## Migration state

- **0001–0013 preserved** (not edited).
- **0014** added: org-scoped unique visible Branch names (`lower(btrim(name))`).
- **Local apply:** not applied (`schema_migrations` has no `0014_branch_name_uniqueness.sql`; index absent). Operator uniqueness still holds via application lock + check.
- **Hosted:** not applied. No `test:supabase`.

## New issue found (not in Fresh 030–036; not fixed)

### BUG-037 — `next start` refuses local `.env.local` DATABASE_URL when `.env` sets `GAMING_SUPABASE_PROJECT_REF`

**Severity:** Medium (local production-mode smoke)  
**Category:** Environment / startup  
**Actual:** After `npm run build`, `npx next start -p 3000` failed instrumentation: `Database URL project ref does not match GAMING_SUPABASE_PROJECT_REF` because `.env.local` points at `127.0.0.1` / `gaming_center_security_test` while `.env` still has a hosted project ref.  
**Expected:** Local production smoke against the intended local database, or a documented local override that does not require mutating hosted config.  
**DO NOT IMPLEMENT in this P2.** Browser regression used `npm run dev`, consistent with prior Fresh QA.

## Safety confirmation (this P2)

- No hosted DB mutation  
- No `test:supabase`  
- No DB reset  
- Migrations **0001–0013** not rewritten  
- **0014** added in repo; **not** applied to local or hosted Postgres  
- Local QA duplicate renamed (not deleted); P2 unique-rename branch `QA-P2-035-Renamed` left in place  
- `QA-Audit-31-Branch-2` was restored to **ACTIVE** after it was observed **INACTIVE** during browser work (devices on that branch)  
- Nothing committed / pushed / deployed  
- Milestone 9 not started  

---

# Release Hardening — BUG-037 / Migration 0014

**Date:** 2026-08-31  
**Scope:** Investigate and fix BUG-037; apply migration 0014 to local PostgreSQL only if a legitimate migration-owner connection already exists; production `npm run build` + `npm run start` smoke. Did **not** run the final product regression. Did **not** start Milestone 9.

**Remaining Fresh functional counts after this hardening:** Critical **0** · High **0** · Medium **0** · Low **0**.  
**BUG-037:** FIXED.  
**Migration 0014 on local PostgreSQL:** **NOT APPLIED.**

**Release recommendation:** **NOT READY** for Release Candidate. BUG-037 is fixed and production `next start` against local PostgreSQL succeeds. The intended release schema (`0014` unique index) is **not** proven on real local PostgreSQL. Final regression must wait until a migration-owner connection can apply `0014` to `gaming_center_security_test`.

> The Fresh Full Regression findings and P0/P1/P2 appendices above are unchanged historical evidence. This appendix records Release Hardening only.

---

## BUG-037 — Status: FIXED

**Severity (found):** Medium / Environment  
**Reproduction:** `.env.local` sets `DATABASE_URL` to local `gaming_app` @ `127.0.0.1` / `gaming_center_security_test`. `.env` still contains `GAMING_SUPABASE_PROJECT_REF` (hosted leftover). `npm run dev` starts. After `npm run build`, `npm run start` previously failed instrumentation: `Database URL project ref does not match GAMING_SUPABASE_PROJECT_REF`.

**Root cause:** Production `assertRuntimeEnvironment` (`NODE_ENV=production`, i.e. `next start`) always called `assertUrlMatchesProjectRef` whenever `GAMING_SUPABASE_PROJECT_REF` was set. Next.js loads `.env` then `.env.local`. Local URLs classify as `CONNECTION_MODES.LOCAL_OR_DIRECT`; `extractSupabaseProjectRef` is `null`, so the match failed. `npm run dev` skips production checks (`if (env !== "production") return`).

**Configuration strategy:** Active backend is `DATABASE_URL` via existing `classifyPostgresConnection` / `CONNECTION_MODES`. `GAMING_SUPABASE_PROJECT_REF` is enforced only when the runtime URL is a recognized Supabase host (`isSupabaseRuntimeMode`). Leftover/stale/invalid refs are ignored for `LOCAL_OR_DIRECT`. On Vercel, the ref remains required. Hosted pooler with a mismatched ref still fails closed. Validation is not suppressed.

**Local runtime result:** `npm run start` Ready on `http://localhost:3000` with merged env still having `GAMING_SUPABASE_PROJECT_REF` SET and `DATABASE_URL` = `gaming_app` @ `127.0.0.1:5432/gaming_center_security_test`. `GET /api/health/live` and `GET /api/health/ready` both `200 {"status":"ok"}`. No startup config exception. Floor/Reports served local QA data (not an empty hosted project).

**Hosted compatibility:** Unchanged. Matching pooler URL + ref still starts; mismatched project ref still throws; Vercel without a ref still throws. Hosted Supabase was not contacted.

**Files changed:**

- `Code/src/db/connection-mode.ts` — `isSupabaseRuntimeMode`
- `Code/src/core/env.ts` — ref match only in Supabase runtime mode
- `Code/tests/core/env.test.ts` — local leftover/invalid ref; hosted match/mismatch; Vercel missing ref
- `Code/tests/db/connection-mode.test.ts` — local extract ref is null; `isSupabaseRuntimeMode`
- `Code/docs/architecture/DEVELOPMENT_GUIDE.md` — config table: leftover ref does not force local into Supabase mode

**Tests:** `tests/core/env.test.ts` (13) and `tests/db/connection-mode.test.ts` (8). Full suite **92 files / 545 tests PASS**.

**Production-mode result:** PASS (see Production Runtime below). Previously failed `next start` now succeeds against the same local `.env` + `.env.local` pair.

---

## Migration 0014

**Repository status:** `Code/drizzle/0014_branch_name_uniqueness.sql` present. Migrations **0001–0013** not edited.

**Local PostgreSQL before:** database `gaming_center_security_test`, runtime user `gaming_app`. `schema_migrations` ends at `0013_prorated_hour_billing.sql`. Index `core_branches_org_name_normalized_key` **absent**.

**Migration credentials / mechanism:** `MIGRATION_DATABASE_URL` unset in `.env`, `.env.local`, process, User, and Machine environment. `GAMING_TEST_DATABASE_URL` unset. Runtime `gaming_app` is not table owner (`gaming_test_migrator`). Do not reuse `gaming_app` as migrator. Passwords were not guessed.

**Applied?** **No.**

**LOCAL MIGRATION BLOCKED — MIGRATION OWNER CONNECTION REQUIRED**

**Duplicate preflight (non-mutating, `gaming_app` + tenant GUC for the connected user’s memberships):** QA org `01a04dfc-0a09-7695-1337-e8f1fc193603` has **0** normalized same-org duplicates. Visible names: `QA Branch`, `QA-Audit-31-Branch`, `QA-Audit-31-Branch-2`, `QA-P2-035-Renamed`. Full-catalog duplicate scan across all organizations requires a migration-owner connection (FORCE RLS) and was not performed. No unrelated rows were renamed or deleted.

**schema_migrations after this session:** still **0001–0013** only. No `0014_branch_name_uniqueness.sql`.

**Index verification:** `core_branches_org_name_normalized_key` still **absent** on local PostgreSQL.

**Same-org / cross-org DB constraint:** not executed against real PostgreSQL (index not applied). PGlite `tests/db/migrations.test.ts` still proves 0014 on an empty in-process database.

**Hosted:** **NOT applied.** Hosted Supabase was not targeted.

---

## Production Runtime

| Check | Result |
| --- | --- |
| `npm run build` | PASS (Next.js 15.5.23; Environments: `.env.local`, `.env`; one build process) |
| `npm run start` | PASS — Ready in 1880ms |
| Port | **3000** (`http://localhost:3000`) |
| `GET /api/health/live` | **200** `{"status":"ok"}` |
| `GET /api/health/ready` | **200** `{"status":"ok"}` |
| Local DB | Merged runtime URL: `gaming_app` @ `127.0.0.1:5432/gaming_center_security_test`; leftover `GAMING_SUPABASE_PROJECT_REF` still SET; no SSL/Supabase pooler |
| Public smoke | `/` 200; `/login` 200; unauthenticated `/admin`, `/admin/gaming/floor`, `/admin/reports` **307** → `/login` |
| Authenticated smoke | **DONE** (browser autofill, not requested from chat): `/admin` org picker → QA Gaming Center dashboard; Floor occupied tiles; Reports daily tables. Browser console errors **0**. Server start log had no config exception. |

Did not run the full product regression.

---

## Automated validation (this hardening)

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **92 files / 545 tests PASS** |
| `npm run build` | PASS |
| `npm run test:supabase` | **not run** |

---

## Remaining release blockers

1. **LOCAL MIGRATION BLOCKED — MIGRATION OWNER CONNECTION REQUIRED.** Additive `0014` is in the repository and proven on PGlite. It is **not** on local `gaming_center_security_test`. Do not call Release Candidate until `schema_migrations` includes `0014_branch_name_uniqueness.sql` and `core_branches_org_name_normalized_key` exists on that real PostgreSQL instance.
2. Targeted **final product regression** after 0014 is applied locally (not run in this session).

No remaining Fresh functional bugs (Critical/High/Medium/Low = 0). BUG-037 is not a remaining bug.

---

## Safety confirmation (this hardening)

- No hosted DB mutation  
- No `test:supabase`  
- No PostgreSQL reset  
- No guessed credentials  
- No `gaming_app` privilege escalation / table-owner change  
- Migrations **0001–0013** preserved  
- Nothing committed / pushed / deployed  
- Milestone 9 not started  

---

# Local PostgreSQL Migration 0014 Verification

**Date:** 2026-08-31  
**Scope:** Determine whether a legitimate existing local migration-owner connection is already available; apply `0014_branch_name_uniqueness.sql` only if that connection exists. Did **not** change application code. Did **not** run targeted final regression. Did **not** start Milestone 9.

**migration-owner connection available:** **no**

**LOCAL MIGRATION BLOCKED — MIGRATION OWNER CONNECTION REQUIRED**

## Mechanisms checked (no secret values)

| Mechanism | Result |
| --- | --- |
| Canonical runner `npm run db:migrate` (`Code/src/db/run-migrate.ts`) | Requires `MIGRATION_DATABASE_URL`. Not runnable. |
| `MIGRATION_DATABASE_URL` | process **UNSET** · User **UNSET** · Machine **UNSET** · `.env` **absent** · `.env.local` **absent** |
| `GAMING_TEST_DATABASE_URL` (documented privileged equivalent for `test:postgres` only) | process/User/Machine **UNSET**. Not used (that suite is destructive when `GAMING_TEST_ALLOW_RESET=true`). |
| `GAMING_TEST_RUNTIME_DATABASE_URL` / `GAMING_TEST_ALLOW_RESET` | **UNSET** |
| `PGPASSWORD` / `PGPASSFILE` / `PGSERVICEFILE` / `PGSERVICE` / `PGUSER` / `PGDATABASE` / `PGHOST` / `PGPORT` | all **UNSET** |
| `.env` keys | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GAMING_SUPABASE_PROJECT_REF`, `APP_BASE_URL` |
| `.env.local` keys | `DATABASE_URL`, `APP_BASE_URL` |
| pgpass (`%APPDATA%\postgresql\pgpass.conf`, `%USERPROFILE%\.pgpass`, cluster dir) | **ABSENT** |
| `pg_service.conf` | **ABSENT** |
| Docker/Compose | **not present** in this project |
| `psql` on PATH | **not found** |
| Windows Credential Manager names matching postgres/gaming/5432 | **none** |
| Local `pg_hba.conf` | `scram-sha-256` for local/IPv4/IPv6. **No** `trust` / `sspi` / `peer`. `pg_ident.conf` has no maps. Not modified. |
| Documented local migrator role | `gaming_test_migrator` (table owner). No stored credential for it. |
| Runtime `DATABASE_URL` | `gaming_app` only. Not used as migrator. |

## Target verification

Not mutated. Last known local state (runtime `gaming_app`, previous session + this inspection of mechanisms): intended DB is `gaming_center_security_test` on `127.0.0.1:5432`. Application of 0014 was **not** started because no migration-owner connection exists.

## Duplicate preflight

**Not run** with a migration-owner (FORCE RLS). Previous hardening preflight via `gaming_app` + one org GUC showed 0 duplicates in the QA org; that is not a full-catalog scan.

## 0014 application result

**Not applied.** No workaround. `gaming_app` cannot `CREATE INDEX` on `core_branches` (not table owner). Runtime password was not reused. Passwords were not guessed.

## schema_migrations result

Unchanged: ends at `0013_prorated_hour_billing.sql`. `0014_branch_name_uniqueness.sql` absent.

## index result

`core_branches_org_name_normalized_key` **absent**.

## real PostgreSQL same-org test

**Not run** (index not applied).

## real PostgreSQL cross-org test

**Not run** (index not applied).

## application smoke

**Not required** for a blocked apply. Production `next start` from the prior hardening session was not re-run as a migration proof.

## hosted status

**untouched**

## Operator prerequisite

Configure the project’s legitimate **LOCAL** migration-owner connection through `MIGRATION_DATABASE_URL` (or the documented equivalent used only for `npm run db:migrate`) on this machine, targeting **only** `gaming_center_security_test`. Then `cd Code && npm run db:migrate`. Do not point that URL at hosted Supabase for this step. Do not use `gaming_app` / `DATABASE_URL` as the migrator.

## Safety confirmation (this verification)

- No secrets printed  
- No guessed credentials  
- No privilege escalation  
- No DB reset  
- No hosted DB mutation  
- No `test:supabase`  
- Migrations **0001–0013** preserved  
- No application code changes  
- Nothing committed / pushed / deployed  
- Milestone 9 not started  

---

## Re-check — 2026-08-31 (later)

Live working-tree re-inspection after the first blocked verification. Historical sections above were **not** rewritten.

**migration-owner connection available:** **no**

| Check | Result |
| --- | --- |
| `MIGRATION_DATABASE_URL` | process **UNSET** · User **UNSET** · Machine **UNSET** · `.env` **absent** · `.env.local` **absent** |
| `GAMING_TEST_DATABASE_URL` | **UNSET** |
| pgpass / `pg_service.conf` | **ABSENT** |
| Docker/Compose | **not present** |
| `psql` | not on PATH |
| `pg_hba.conf` | still `scram-sha-256` only; **not modified** |
| `.env` / `.env.local` keys | unchanged (`DATABASE_URL` runtime only; no migrator key) |

**0014 application:** not started. No workaround.

**hosted status:** untouched  



---

# Final Clean-Room Acceptance Audit — 2026-09-04 (continuation)

This is an appended QA-only continuation. Historical sections above remain unchanged. Current local filesystem was inspected; HEAD/worktree contain the existing uncommitted UX and hardening changes. No source or migration edits were made by this audit. Milestones 1–8 remain closed; Milestone 9 was not started.

## Verified entry checkpoint

- The supplied handoff actually ended with the 2026-08-31 migration-credential blocker, not a September 4 clean-room checkpoint. Live state supersedes that stale checkpoint.
- Existing Next.js development listener: PID 8044, parent 3600, localhost:3000. PostgreSQL client socket 61689 belonged to PID 8044; pg_stat_activity mapped it to gaming_app on gaming_center_cleanroom_20260904b at 127.0.0.1. No app connection to hosted Supabase was observed.
- Both /api/health/live and /api/health/ready returned HTTP 200 with status ok.
- Runtime SQL identity independently returned current_database() = gaming_center_cleanroom_20260904b and current_user = gaming_app. Role was NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE.
- schema_migrations contained all 14 migrations, 0001–0014, applied 2026-09-04 at 15:39:47 UTC. core_branches_org_name_normalized_key exists. Database creation and migrations were NOT repeated.
- Bootstrap was NOT complete on entry: /api/setup/status returned firstUserRequired=true, core_users count=0, and all bootstrap claim/owner/organization fields were null. /setup displayed the first-owner form.
- The external secret file's default DATABASE_URL names a protected database. It was never used unchanged: every connection in this audit was explicitly pinned in memory to local gaming_center_cleanroom_20260904b. Permanent secret files were not edited.

## BUG-038 — Development first-owner submission returns HTTP 500

- **Severity:** Medium (development runtime; production retest succeeds).
- **Category:** Runtime / bootstrap availability.
- **Location:** /setup → POST /api/auth/sign-up/email, existing next dev process.
- **Steps:** Open first-owner form on the empty clean-room database; fill a QA identity, valid generated password, and the existing local bootstrap token; submit. Repeat once after initial route compilation completes.
- **Expected:** Create the first owner once and continue to authenticated organization setup.
- **Actual:** Both submissions return HTTP 500; Arabic form displays Request failed (500). Server logs report Jest worker encountered 2 child process exceptions, exceeding retry limit, page /api/auth/sign-up/email. Core user count remains zero; bootstrap claim remains null.
- **Evidence:** docs/qa-evidence-20260904/bootstrap-500.png; Code/.cleanroom-dev.log includes POST /api/auth/sign-up/email 500 in 14390ms and 500 in 1722ms with WorkerError. Password/token are masked in the screenshot and are not recorded here.
- **Regression status:** Reproduced twice on the inherited development process. Not reproduced after a successful production build and next start using process-only clean-room environment overrides. No source fix; root cause not established.

## Production and successful browser work

- Stopped only the identified development parent/worker (3600/8044) before build. Production build completed successfully (Next.js 15.5.23).
- Started next start -p 3000 (PID 14644), using local gaming_app / gaming_center_cleanroom_20260904b and the existing bootstrap token via process environment only. Runtime log: docs/qa-evidence-20260904/production.log. Both health endpoints returned 200.
- Production first-owner form succeeded, then browser logout → /login → login succeeded. Created Cleanroom Gaming 20260904b through the organization form. Guided Setup opened automatically. Saved branch Cleanroom Main through its form.
- Owner: Cleanroom QA Owner, owner.cleanroom.20260904b@example.test; core user ID 01a06d5e-4fa8-7db8-df6e-a5edb917673a.
- Organization ID: 01a06d5e-8d7b-7282-6a63-7a07d19f668b. Branch ID: 01a06d5e-cffc-7bbe-8073-040b785f7946.
- Subsequent read-only SQL confirmed exactly one core user and populated first-owner/organization bootstrap fields. Do not repeat bootstrap or organization/branch creation.

## Audit tooling interruption — not an application defect

The node_repl browser tool exceeded its 30-second invocation timeout during save/advance of the branch step and reset its kernel. The branch was persisted, but the browser context and generated password held only in memory were lost. The owner was not reset, no session was forged, and authentication was not bypassed. A request for permission to reset only this temporary QA owner's password was presented to the user. Authenticated continuation requires restored QA login access. This tooling interruption is not assigned an application bug number.

## Additional production checks

- /setup now redirects to /login; /api/setup/status returns firstUserRequired=false.
- Anonymous GET of /api/branches, /api/customers, /api/gaming/floor, /api/reports, /api/audit, /api/memberships, /api/settings: all 401 with generic unauthenticated errors.
- Public login: Arabic lang=ar/dir=rtl and English dir=ltr. At widths 1440, 768, and 390, document scroll width equals viewport width; login inputs have associated labels. This is a public-page check only, not full admin responsive/accessibility acceptance.
- Invalid English login returns Invalid email or password and stays at /login; expected 401 is visible in browser console.
- Automated validation is running; final results and coverage verdict will be appended below.


## Coverage boundary at the browser interruption

| Acceptance item | This continuation |
| --- | --- |
| Effective clean-room database, role, migration state | Verified directly; no creation/migration repeated |
| Production build/start and health | PASS |
| First Owner, logout, /login, organization creation | PASS through real browser |
| Guided Setup / branch | Automatic wizard and first branch save verified; remaining wizard steps blocked |
| Branch management page | Not exercised |
| Areas / Device Types / Devices / Pricing / Customers | Browser acceptance not exercised |
| Floor → Start → Pause → Resume → Move → End | Browser acceptance not exercised |
| Critical 100 SYP/hour short moved session | Automated regression test passed; real-browser 10 SYP final bill NOT VERIFIED |
| Checkout / Payments / Reports / Audit | Browser acceptance not exercised |
| Staff / Roles / branch and tenant authorization | Automated coverage plus anonymous production rejection checks; authenticated browser matrix not exercised |
| Settings | Browser acceptance not exercised |
| Arabic / English / responsive / accessibility | Public login only; admin matrix unverified |
| Console / Network | Expected invalid-login 401s on public production checks; authenticated run incomplete |

Additional public results: Arabic invalid-login message is localized; native login form uses POST /login; /admin, /admin/gaming/floor, /admin/reports, /admin/users return 307 to /login anonymously. Dark theme persists on reload. Stable mobile screenshot: docs/qa-evidence-20260904/login-ar-dark-mobile-stable.png. The earlier dark screenshot was taken during theme transition and must not be used as contrast-failure evidence. No comprehensive WCAG conformance claim.


## Final automated validation — this continuation

| Command | Result |
| --- | --- |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm test | PASS — 92 files / 545 tests, duration 896.39 seconds |
| npm run build | PASS — Next.js 15.5.23, all 33 static pages generated |
| next start -p 3000 | PASS — retained production PID 14644 |
| Final /api/health/live and /api/health/ready | Both 200, status ok |
| Final /api/setup/status | 200, firstUserRequired=false |
| test:postgres | NOT RUN — protected live test database must remain untouched |
| test:supabase | NOT RUN |

The normal Vitest configuration excludes postgres-live.test.ts and supabase-hosted.test.ts. Local guard/compatibility unit tests whose names contain Supabase do not connect to hosted Supabase and are not the test:supabase command. No real PostgreSQL test-suite reset was performed.

The critical automated regression passed: charges the PRORATED_HOUR 5-minute minimum once after MOVE, not once per segment. This does NOT replace the requested real-browser reproduction at 100 SYP/hour with positive total time under five minutes. That browser reproduction remains unverified.

## Final acceptance decision

**NOT READY**

Reason: the requested clean-room acceptance coverage is incomplete after the browser-tool session loss. No authenticated browser evidence exists in this continuation for Areas through Settings, the full session/payment journey, the staff/roles authorization matrix, or admin responsive/accessibility coverage. It would be incorrect to issue a release-candidate verdict from passing automated tests alone.

New application findings in this continuation: BUG-038 only (Medium, inherited development bootstrap worker failure; production retest passed without source changes). The QA-tool timeout and loss of temporary login credentials are audit execution limitations, not application defects. No claim is made that the 20 SYP regression recurred.

## Exact next resume point

1. Verify current listener, effective database/role, health, migration count, and this handoff against live state again.
2. Restore authorized login access for the existing temporary QA owner. Permission to reset only that QA account was requested but no response had been received when this appendix was finalized. No password reset or account-record modification was performed. Do not reset bootstrap or recreate the owner, organization, branch, database, or migrations.
3. Resume at /login, then Guided Setup for Cleanroom Gaming 20260904b. Cleanroom Main already exists. Continue from the earliest incomplete wizard step (Areas), and separately cover branch management before the remaining requested flow.
4. Create pricing/devices/customers through real browser forms; execute the exact 100 SYP/hour A→B positive-duration under-five-minute scenario and capture a final bill of 10 SYP, or document a defect if it differs.
5. Finish the remaining browser matrix and append additional results. New bug numbers after this continuation begin at BUG-039.

## Final safety confirmation — scope of this continuation

- gaming_center_security_test untouched.
- gaming_center_rc_e2e_20260904 untouched.
- gaming_center_cleanroom_20260904b retained, including the QA owner, organization, and branch.
- Hosted Supabase untouched; no hosted Supabase connection used.
- test:supabase not run.
- No source fixes or migration changes.
- No .env.local changes; permanent secrets files unchanged.
- Nothing committed.
- Nothing pushed.
- Nothing deployed.
- Milestone 9 not started.

HEAD remains 5fe4e63 on master. Existing dirty worktree was preserved. Only QA handoff/evidence was added by this continuation; normal build/test outputs were regenerated. Production app is left running locally against the retained clean-room database.
