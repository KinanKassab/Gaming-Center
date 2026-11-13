# Identity, authentication, and authorization

How Milestone 2 answers: **who** is the user, **which** organization are they
acting inside, **which** branches can they reach, and **what** may they do.
Design decisions are recorded in ADR 0003 / 0004 / 0007.

## Layers

```
Better Auth (auth_users / auth_sessions / auth_accounts / auth_verifications)
        │  session cookie ──► auth.api.getSession()
        ▼
core_users.auth_subject        ← opaque provider subject, no FK
        ▼
core_organization_memberships  ← INVITED / ACTIVE / SUSPENDED, per organization
        ▼
core_membership_roles ─► core_roles (ACTIVE) ─► core_role_permissions
        │                                            │
        │                                            ▼
        │                              effective permissions (union)
        ▼
core_branch_access             ← VIEW / OPERATE / MANAGE per branch
```

- `src/auth/*` is the **only** code that imports Better Auth.
- `src/modules/identity/*` owns all domain tables and admin use-cases.
- `src/app/*` (pages and API routes) is a delivery shell: parse input, resolve
  context, call use-cases, render/serialize.

## Authentication flow

1. Login UI posts to Better Auth endpoints under `/api/auth/*`
   (email + password; interim default per ADR 0007). Public HTTP sign-up is
   **not** open: `POST /api/auth/sign-up/email` requires
   `GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN` (header `x-gaming-bootstrap-token`) and
   an unused `core_platform_bootstrap` slot. The first owner is created on
   `/setup`. After that identity exists, HTTP sign-up fails closed. Additional
   logins are created only by an owner via `createAuthAccountProvisioner`
   (`auth.api.signUpEmail`, not the public HTTP path).
2. Better Auth sets an httpOnly session cookie and, via database hooks:
   - sign-up provisions the Core User (`ensureCoreUser`),
   - session creation stamps `core_users.last_login_at`.
3. `authenticateRequest(db, auth, headers)`:
   - resolves the Better Auth session (rejects with 401 when absent),
   - maps `session.user.id → core_users.auth_subject` (creates/re-syncs),
   - rejects non-ACTIVE Core Users with 403 (disabled users are blocked even
     with a valid provider session).

A Core User row alone grants **no** organization access.

## Organization context

- The selected organization id is an httpOnly cookie (`gc_organization_id`).
  It is only a selector. `resolveOrganizationContext`:
  1. loads the membership for (authenticated user, selected organization),
  2. requires status ACTIVE (INVITED and SUSPENDED are rejected with 403),
  3. requires the organization itself to be ACTIVE,
  4. loads effective permissions (union across ACTIVE roles),
  5. loads explicit branch grants.
- The result is an `OrganizationActor { userId, organizationId, membershipId,
  permissions, branchAccess }` — the only identity object domain use-cases
  accept.
- Pre-selection queries (list my organizations) run under transaction-local
  `app.user_id`; RLS policies expose exactly the user's own membership
  rows and their organizations. There is no RLS bypass GUC on the request path.

## Authorization pipeline (every privileged operation)

```
authenticate → resolve Core User → validate ACTIVE membership
→ organization context → verify branch belongs to organization
→ verify branch access (assertBranchAccess) → verify permission
(assertPermission) → zod-validate input → transaction (withTenant)
→ domain writes → audit record (same transaction)
```

- Use-cases in `src/modules/identity` enforce permissions internally, so a
  directly-invoked API cannot skip checks; the UI merely hides what the
  server already rejects.
- `withTenant` sets `app.organization_id` and `app.user_id`
  transaction-locally; composite FKs and forced RLS are the database
  backstops. Runtime connections use `gaming_app` (`NOSUPERUSER`,
  `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `LOGIN`).
  `DATABASE_URL` is that request role. `MIGRATION_DATABASE_URL` is
  migrations/admin only. Provisioning (`0004` + `npm run db:migrate`) pins
  those attributes or fails closed; a refused `ALTER ROLE` is not treated as
  success. `getSafeRuntimeDb()` is defense in depth on the request path.

## Branch access (Milestone 2 vs later)

Milestone 2 stores `core_branch_access` grants and administers them. It does
**not** yet have branch-scoped business operations (sessions, POS, inventory).
Do not invent `assertBranchAccess` calls where no branch-owned subject exists.
**Every future operation that targets branch-owned data MUST call
`assertBranchAccess` after organization resolution.** That rule is also in
`.cursor/rules/20-backend-security.mdc`.

## Membership lifecycle

| Transition | Actor | Notes |
| --- | --- | --- |
| create ACTIVE (with new login) | admin (`core.memberships.manage`) | admin sets initial credentials; `joined_at` now |
| attach INVITED (existing account) | admin | by email; no email is sent (transport NEEDS DECISION) |
| INVITED → ACTIVE | the invited user | self-consent: selecting the organization activates it. Database trigger + RLS allow only this self-service write; `organization_id` and `user_id` cannot change. |
| ACTIVE/INVITED → SUSPENDED | admin | also used to revoke invitations |
| SUSPENDED → ACTIVE or INVITED | admin | returns to pre-suspension state via `joined_at`. Members cannot unsuspend themselves. |

## Safety invariants

- **Anti-escalation:** assigning a role or adding permissions to a role is
  rejected when it would grant permissions the acting user does not hold.
- **Last-admin:** the organization must always retain one ACTIVE membership
  (ACTIVE user) whose effective permissions include
  `core.memberships.manage` and `core.roles.manage`; violating mutations are
  rolled back in-transaction behind `FOR UPDATE` on the organization row.
  This is an application-transaction invariant plus the restricted runtime
  role. There is no extra SQL trigger for last-admin (permission semantics
  live in application code). Concurrent overlapping removals are tested;
  real PostgreSQL locking proof is `npm run test:postgres` against disposable
  `gaming_center_security_test` when available.
- System roles (seeded OWNER) cannot be renamed, archived, or re-permissioned.
- Cross-tenant references (roles, memberships, branches, branch access) are
  blocked by tenant-scoped queries **and** composite foreign keys **and** RLS.

## Audit

Every identity/admin mutation appends to `core_audit_logs` in the same
transaction: `core.organization.created/updated`, `core.branch.created/
updated/archived`, `core.user.created`, `core.membership.created/invited/
activated/suspended/reactivated/role_assigned/role_removed`,
`core.role.created/updated/archived/permissions_set`,
`core.branch_access.granted/updated/revoked`. Rows carry actor, organization,
optional branch, entity, before/after snapshots — never passwords, tokens, or
other secrets. The table is append-only (trigger-enforced).

## HTTP surface (Milestone 2)

| Route | Methods | Permission |
| --- | --- | --- |
| `/api/auth/[...all]` | Better Auth | Public sign-in/sign-out/session. `POST /api/auth/sign-up/email` is **gated**: bootstrap token header `x-gaming-bootstrap-token` plus unused platform singleton. In-process `auth.api.signUpEmail` is used only for admin staff provisioning. |
| `/api/setup/status` | GET | `{ firstUserRequired }` (UI only; not a security control) |
| `/api/me` | GET | authenticated |
| `/api/organizations` | POST | authenticated; **initial organization only** (platform singleton). Further tenants are NEEDS DECISION. |
| `/api/organizations/select` | POST | own membership |
| `/api/organizations/current` | GET / PATCH | `core.organizations.read` / `.manage` |
| `/api/branches`, `/api/branches/:id`, `…/archive` | GET / POST / PATCH / POST | `core.branches.read` / `.manage` |
| `/api/memberships` | GET / POST | `core.memberships.read` / `.manage` |
| `/api/memberships/:id/status` | POST | `core.memberships.manage` |
| `/api/memberships/:id/roles/:roleId` | PUT / DELETE | `core.memberships.manage` (+ anti-escalation) |
| `/api/memberships/:id/branch-access/:branchId` | PUT / DELETE | `core.memberships.manage` |
| `/api/roles`, `/api/roles/:id`, `…/archive`, `…/permissions` | GET / POST / PATCH / POST / PUT | `core.roles.read` / `.manage` |
| `/api/permissions` | GET | `core.roles.read` |
| `/api/audit` | GET | `core.audit.read` |
| `/api/settings`, `/api/settings/:key` | GET / PUT / DELETE | `core.settings.read` / `.manage` |
| `/api/settings/:key/branches/:branchId` | PUT / DELETE | `core.settings.manage` + `assertBranchAccess` MANAGE |
| `/api/features`, `/api/features/:code` | GET / PUT | `core.settings.read` / `.manage` |
| `/api/customers`, `/api/customers/:id`, `…/archive` | GET / POST / PATCH / POST | `core.customers.read` / `.manage` |
| `/api/gaming/areas`, `/api/gaming/areas/:id`, `…/archive` | GET / POST / PATCH / POST | `gaming.master.read` / `.manage` + `assertBranchAccess` |
| `/api/gaming/device-types`, `…/:id`, `…/archive` | GET / POST / PATCH / POST | `gaming.master.read` / `.manage` |
| `/api/gaming/devices`, `…/:id`, `…/archive` | GET / POST / PATCH / POST | `gaming.master.read` / `.manage` + `assertBranchAccess` |
| `/api/gaming/pricing-plans`, `…/:id`, `…/archive` | GET / POST / PATCH / POST | `gaming.master.read` / `.manage` |
| `/api/gaming/pricing-assignments`, `…/:id` | GET / POST / PATCH | `gaming.master.read` / `.manage` (+ branch access when scoped) |
| `/api/gaming/floor` | GET | `gaming.sessions.read` + `assertBranchAccess` VIEW |
| `/api/gaming/sessions`, `…/:id` | GET / POST / GET | `gaming.sessions.read` / `.start` + branch access |
| `/api/gaming/sessions/:id/pause\|resume\|end\|move\|customer` | POST | `gaming.sessions.operate` + OPERATE |
| `/api/gaming/sessions/:id/cancel` | POST | `gaming.sessions.cancel` + MANAGE |
| `/api/gaming/sessions/:id/billing` | GET | `gaming.sessions.read` + VIEW |
| `/api/gaming/sessions/:id/billing/finalize` | POST | `gaming.sessions.operate` + OPERATE |

Minimal admin pages (`/admin`, `/admin/branches`, `/admin/users`,
`/admin/roles`, `/admin/customers`, `/admin/gaming`, `/admin/settings`,
`/admin/audit`) render through the same use-cases and hide actions the server
would reject anyway. Header navigation lists a destination only when the actor
has the matching read permission. Gaming master-data pages live under
`/admin/gaming/*` and are gated by `gaming.master.read`.

Remaining LOW identity debt (does not reopen Milestone 2): `auth_users.email`
uniqueness is case-sensitive while `core_users` email uniqueness is
case-insensitive. Production CSRF requires a matching Origin (no missing-Origin
allowance, no localhost `APP_BASE_URL` default).
