# UX / Product Consolidation Pass

Status: **IN DEVELOPMENT** (not complete until browser verification).

This is **not** Milestone 9. Platform adaptation remains IN DEVELOPMENT. Do not treat this pass as a brand-identity lock for Akodus.

## Product principles

**Extreme simplicity.** The owner should feel like they are configuring their gaming center, not configuring software.

Normal users must not need internal codes, UUIDs, minor units, seconds, rounding enums, or database status values.

**Auto-configure first.** When the owner gives a business input (name, price, count), the server fills safe technical defaults (internal code, timezone from the organization, ENABLED devices, currency, billing period).

**Progressive disclosure.** Normal forms are business-friendly. Advanced settings stay collapsed. Implementation details stay out of the default UI. Useful database columns are not dropped merely because they are hidden.

## Design system

Reusable CSS tokens live in `src/app/globals.css`. Direction: premium operational SaaS — professional, fast, desktop-first with strong mobile support. Not childish. Not gamer neon. Comfortable for long staff shifts.

Tokens cover surfaces, text, borders, accent, success, warning, danger, muted, typography (DM Sans), spacing, radius, shadows, focus, and reduced-motion.

Primitives: app shell, sidebar, mobile bottom nav, top bar, page header, cards, stat cards, buttons, inputs, duration picker, money input, FieldHelp, confirm dialog, empty/loading/error states, status badges, tables with mobile record cards, stepper, setup checklist.

ui-ux-pro-max was used as advisory design intelligence (Soft UI Evolution, dense operations dashboard, subtle motion, status color semantics). The mint-green “ops landing” palette from that tool was **not** adopted; occupancy already uses green/amber, and a navy/slate command console is clearer for multi-hour staff use. No Akodus brand lock.

## Internal codes

`code` columns and uniqueness constraints remain. Normal create forms omit `code`. The server allocates a collision-safe identifier (`B-` / `A-` / `T-` / `D-` / `P-` + UUID fragment) with retry on unique violation. Explicit codes remain valid on API/advanced paths. Display names are what humans see.

## Bulk device creation

`POST /api/gaming/devices/bulk` creates a bounded batch (max 50) in one tenant transaction. Preview names in the UI. Same `gaming.master.manage` + branch MANAGE as single create. Audit: per-device `gaming.device.created` plus `gaming.device.bulk_created`.

## Pricing UI adapter

Friendly owner create (management page and wizard):

- Hourly: choose a **device type**, set the hourly price (major units, organization currency). The server names the plan from the type and assigns it with `scope_type = DEVICE_TYPE`.
- Offer (optional): choose one or more device types, a duration, a name, and a lump-sum price. Stored as a PACKAGE plan assigned to those types.

The server stores hourly `time_billing_mode = PRORATED_HOUR`. Play time is rounded to the nearest 5 minutes (HALF-UP). A positive session never rounds to free (minimum 5 minutes). Price is hourly × rounded minutes / 60, then rounded to the nearest 5 currency units (HALF-UP). Integer/rational math only.

Legacy UNIT plans (`time_billing_mode = UNIT`, including older CEIL/FLOOR/NEAREST rows) keep unit-based billing. Snapshots capture the mode and prorated constants at session start. Finalized totals are not recalculated.

When hourly and an offer are both assigned to the same device type, session start still resolves the hourly TIME_BASED plan. Offers remain available as PACKAGE assignments. The pricing page no longer shows manual assignment editors (organization/branch/area/device); `POST /api/gaming/pricing-assignments` remains for other callers.

| UI | Stored (new hourly prices) |
| --- | --- |
| Device type | DEVICE_TYPE assignment (`scope_id` = device type) |
| Hourly price | `rate_minor` via integer `majorToMinor`; `billing_unit_seconds = 3600` |
| (automatic) | `time_billing_mode = PRORATED_HOUR`; plan `name` from the device type |
| Optional minimum charge | `minimum_charge_minor` |

| UI | Stored (offers) |
| --- | --- |
| Offer name | plan `name` |
| Duration | `package_duration_seconds` |
| Fixed price | `package_price_minor` |
| Device types | DEVICE_TYPE assignments (lower priority than hourly) |

Copy: “X per hour”, with FieldHelp explaining 5-minute time rounding and 5-unit money rounding.

## Duration picker

Hours + minutes (seconds only when needed). Presets: 30 min, 1 hour, 1.5 hours, 2 hours, 3 hours, plus Custom wheels. Canonical output is seconds. Staff never type `3600`.

## FieldHelp

Click/tap opens a short what / choose / example panel. Not hover-only. On narrow screens the panel docks near the bottom.

## Gaming Center Setup Wizard

`/admin/onboarding` is **business** setup after the organization exists. `/setup` remains first-owner identity bootstrap and is not reopened by this wizard.

Steps: Welcome → Branch → Areas → Devices (types + quantity) → Pricing → pricing review popup → Staff (optional) → Finish.

Payment methods (Cash + Sham Cash) are still seeded when the organization is created. Pricing assignments to `DEVICE_TYPE` are created when hourly/offer prices are saved. Those remain **internal** readiness flags — they are not wizard stepper items.

The Devices step checkboxes create a type (and one station when a branch/area exist). Quantity only adds the difference. Unchecking archives the type and free stations in one transaction (`archiveWizardDeviceType`); occupied stations refuse with `device_type_in_use`.

Completion is derived from actual rows (branch, area, device type, device, plan, active assignment, payment methods, extra membership). No wizard progress table. Existing organizations may open it. Finish goes to the Gaming Floor when operationally ready. Save and continue later returns to the dashboard.

## Session persistence and public entry

Better Auth sessions remain the only login cookie (`autoSignIn` stays false so staff provisioning does not mint sessions). Expiry is 7 days with a 1-day sliding refresh. `/setup` still signs up, then explicitly signs in with `credentials: "same-origin"`, then goes to `/admin`. `/` and `/login` call `tryAuthenticateRequest` and redirect a usable session to `/admin`. Locale cookies are presentation-only and never participate in that decision.

## Locale and RTL

Product default is Arabic (`lang="ar"` `dir="rtl"`). English is `lang="en"` `dir="ltr"`. Root layout reads `gc_ui_locale` only (fallback `ar`); it does not query the database for `lang`/`dir`. `core_organizations.locale` is the business default. `gc_ui_locale_source=user` is a personal override that org create/switch must not replace. Cookies: HttpOnly, Path=/, SameSite=Lax, Secure in production. In-repo `ar`/`en` dictionaries; no next-intl. Arabic UI uses Noto Sans Arabic; DM Sans stays for Latin. Money display grouping is locale-aware; canonical `formatMinorAmount` / billing math are unchanged.

First organization form: business name, currency, language names (العربية / English). Timezone is hidden; browser IANA via `Intl`, server fallback `Asia/Damascus`. Timezone remains editable later on the dashboard Business profile and Settings.

## Guided Setup

When setup is incomplete, `/admin` opens Guided Setup as a large desktop dialog / mobile full-screen panel reusing `OnboardingWizard` and the existing APIs. `/admin/onboarding` remains as a resume URL. Close / Save & continue later keeps saved rows and shows Continue Setup. The prompt stops auto-opening when `operationallyReady` is true.

## Owner dashboard

`/admin` is a remote command center: occupancy, active/paused sessions, billed today (finalized session totals), payments recorded today (not accounting revenue), outstanding charges, recent staff activity, needs-attention. Branch selector when multiple branches exist. Incomplete setup is Guided Setup, not a localStorage-dismissed checklist.

## Navigation

Primary: Dashboard, Gaming Floor, Reports, Customers. Management: Branches, Areas, Device types, Devices, Pricing, Staff, Roles. Workspace: Setup wizard, Settings, Activity. Session history lives on Reports. Permission-gated visibility does not authorize; APIs still enforce.

## Database

Auto-codes, wizard status, and bulk devices use existing columns and application transactions.

Approved hourly billing required an additive column: `drizzle/0013_prorated_hour_billing.sql` (`time_billing_mode` UNIT | PRORATED_HOUR, default UNIT). It does not rewrite 0001–0012, snapshots, or finalized totals. Do not apply 0013 to hosted Supabase until a human authorizes it.
