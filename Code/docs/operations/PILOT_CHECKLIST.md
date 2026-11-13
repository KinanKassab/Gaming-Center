# Pilot go-live checklist

Use this as pass/fail before a real Gaming Center takes money.

Milestone 8 is **CLOSED**. Real-money pilot is **CONDITIONAL GO** (not GO).

All of the following must be true before taking real money:

1. Hosting chosen and provisioned
2. Managed PostgreSQL (not ephemeral disk)
3. Runtime `gaming_app` pinned NOSUPERUSER / NOBYPASSRLS / NOCREATEDB / NOCREATEROLE / NOINHERIT / LOGIN
4. Separate migrator credentials; never used as `DATABASE_URL`
5. Dedicated BYPASSRLS (or backup-only superuser) dump/restore path — not `gaming_app`
6. Encrypted off-box backups; restore ownership defined
7. Owner approval of RPO/RTO (engineering proposal 24h / 4h until then)
8. Public https `APP_BASE_URL` matching the real hostname; unique ≥32-character `BETTER_AUTH_SECRET`
9. Real center bootstrapped through `/setup` + admin UI (Better Auth HTTP gate + initial organization). Not ad-hoc SQL into auth tables.
10. Staff briefing: PACKAGE+MOVE forbidden; no refunds/voids; ShamCash is staff-recorded; reports are not accounting revenue; device-usage billed is not a revenue split

## SECURITY

- [ ] `BETTER_AUTH_SECRET` is unique, ≥ 32 characters, not in git
- [ ] Production `APP_BASE_URL` is the public https origin (not a silent localhost default)
- [ ] Session cookies are HttpOnly, SameSite=Lax, Secure on HTTPS
- [ ] CSRF: production mutations without matching Origin are denied
- [ ] Security headers present (frame deny, nosniff, CSP, referrer)
- [ ] Disabled users cannot use a leftover login session
- [ ] Cross-tenant IDs return not-found / no access, never the other org’s row

## DATABASE

- [ ] `DATABASE_URL` user is `gaming_app` (NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN)
- [ ] `MIGRATION_DATABASE_URL` is a different credential
- [ ] Migrations 0001–0012 applied; migrate pins `gaming_app` or fails closed
- [ ] If deploying to Vercel/Supabase: `VERCEL_SUPABASE_DEPLOYMENT.md` followed; Preview not using Production `DATABASE_URL`
- [ ] Runtime has no DELETE on sessions, payments, charges, audit, customers, devices
- [ ] FORCE RLS remains on tenant tables

## AUTH

- [ ] Sign-in / sign-out works; sign-out clears `gc_organization_id`
- [ ] Public `POST /api/auth/sign-up/email` is denied after first owner (and when the bootstrap token is unset)
- [ ] Staff cannot `POST /api/organizations` after the initial organization exists
- [ ] Organization selector cannot grant another org
- [ ] Invitation leftover (INVITED) cannot operate until accepted

## BRANCH ACCESS

- [ ] VIEW cannot start/end sessions or record payments
- [ ] Staff without a branch grant cannot see that branch’s floor

## DEVICES

- [ ] ENABLED + free can start; MAINTENANCE/DISABLED cannot
- [ ] Occupied is derived from ACTIVE/PAUSED sessions

## SESSIONS

- [ ] Guest and customer start paths work
- [ ] Pause / resume / end work; two operators cannot occupy one device
- [ ] PACKAGE + MOVE is rejected

## BILLING

- [ ] TIME_BASED finalize uses segment snapshots, not current prices
- [ ] Unfinalized completed sessions are visible as unbilled, not as 0

## PAYMENTS

- [ ] Checkout copies finalized `gaming_total_minor` only
- [ ] CASH records locally; ShamCash copy says staff-recorded / not API-verified
- [ ] Duplicate Idempotency-Key does not double-apply
- [ ] Guest cannot leave a remainder; registered customer can pay partial
- [ ] Refunds/voids are **not** available — communicate this to staff

## BACKUPS / RESTORE

- [ ] Dump schedule exists; encryption and access control exist
- [ ] Restore drill proved session bill + charge + payment + allocation survive
- [ ] RPO/RTO proposal reviewed (24h / 4h unless the owner picks other numbers)

## LOGGING / HEALTH

- [ ] `/api/health/live` and `/api/health/ready` work from the platform
- [ ] Logs include `requestId`; secrets are not logged

## BROWSER FLOW

- [ ] Sign in → org → customer → start → occupied floor → pause → resume → end → billing → CASH pay → PAID
- [ ] Guest session full pay
- [ ] ShamCash recording does not claim provider verification
- [ ] Duplicate customer warning is visible (non-blocking)

## DEPLOYMENT / ROLLBACK / SUPPORT

- [ ] Deploy order (backup → migrate → app → ready → smoke) is written down
- [ ] App rollback vs forward-fix migration is understood
- [ ] Incident table in `PILOT_RUNBOOK.md` is available to the operator
- [ ] PACKAGE restriction and “no refunds” are briefed to cashiers
