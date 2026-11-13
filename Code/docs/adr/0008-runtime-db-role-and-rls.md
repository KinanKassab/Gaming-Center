# ADR 0008 — Runtime vs migration database roles and RLS without GUC bypass

- Status: Accepted
- Date: 2026-08-25

## Context

Independent review of Milestone 2 found that tenant RLS policies included
`app_bypass_rls()` reading the GUC `app.bypass_rls`. Any role that can call
`set_config` (including `gaming_app`) could neutralize RLS. The runtime
client also used whatever role `DATABASE_URL` contained, so a superuser or
table-owner URL would skip FORCE RLS. Membership self-update RLS allowed
`user_id = app_current_user_id()` without column restrictions.

## Decision

1. **No request-path RLS bypass GUC.** Policies compare tenant columns to
   `app.organization_id` / `app.user_id` only. `app_bypass_rls()` is dropped
   (migration `0003`). Administrative SQL uses a privileged connection that
   is never used for HTTP requests.
2. **Two database URLs.**
   - `DATABASE_URL` — request runtime — role `gaming_app` (or
     `RUNTIME_DB_ROLE` if an equivalently restricted role is documented).
     Must not be superuser, must not have `BYPASSRLS`, must not own tenant
     tables in a way that skips FORCE RLS.
   - `MIGRATION_DATABASE_URL` — schema migrations and break-glass admin SQL
     only. `npm run db:migrate` refuses to run on `DATABASE_URL`.
3. **Startup assertion.** Request handlers call `getSafeRuntimeDb()` which
   fails closed if the connected role is unsafe. This is defense in depth,
   not the provisioning mechanism.
4. **Provisioning fail-closed (migration `0004` + `npm run db:migrate`).**
   `gaming_app` must be `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
   NOINHERIT LOGIN`. The privileged migration connection either ALTERs the
   role or, if ALTER ROLE is refused, verifies `pg_roles` and **aborts** when
   attributes are still unsafe. A refused ALTER ROLE is never treated as a
   successful pin. Historical `0003` still NOTICE-continues on
   `insufficient_privilege`; `0004` is the forward-safe enforcement. Do not
   rewrite already-applied `0001`–`0003`.
5. **Membership writes.** `organization_id` and `user_id` are immutable
  (trigger). Self-service UPDATE is INVITED → ACTIVE only. Admin status
  changes remain organization-scoped application operations.
6. **CSRF (interim).** Admin JSON APIs are same-origin. Cookies are
   SameSite=Lax. Mutation routes reject a mismatched `Origin`. Stronger
   CSRF (tokens / always-required Origin) is required before cross-origin
   admin clients, cookie-authenticated form POSTs from other sites, or
   non-JSON mutations. Better Auth keeps its own origin checks on
   `/api/auth/*`.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Keep `app.bypass_rls` and “always set it off” in `withTenant` | The GUC is user-settable; application discipline is not a security boundary |
| `SET ROLE gaming_app` per request on a superuser pool | Easy to miss; pooling leftover session state; weaker than a dedicated login |
| SECURITY DEFINER bypass helper | Broad superuser-equivalent if mis-granted |

## Consequences

- Tests that previously skipped when `gaming_app` was missing now fail.
- PGlite tests exercise RLS via `SET ROLE gaming_app` after privileged seed.
- Real PostgreSQL locking/role proof is `npm run test:postgres` with
  `GAMING_TEST_DATABASE_URL` pointing at disposable database
  `gaming_center_security_test` and `GAMING_TEST_ALLOW_RESET=true`. Missing
  URL is **BLOCKED BY ENVIRONMENT**. A reachable database is not treated as
  disposable: reset refuses `postgres`, `template0`, `template1`, and any
  name other than the approved disposable database. PGlite is not a
  substitute for that proof. `npm test` never opens real PostgreSQL.

## Reversibility

Policy SQL can be refined. Re-introducing a runtime-controlled RLS skip is
forbidden.
