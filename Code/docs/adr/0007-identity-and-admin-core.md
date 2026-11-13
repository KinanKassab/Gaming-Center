# ADR 0007 — Identity & admin core implementation (Milestone 2)

- Status: Accepted
- Date: 2026-08-25

## Context

Milestone 2 wires authentication (ADR 0003 chose Better Auth) to the blueprint's
identity model (`core_users` → memberships → roles/permissions → branch access)
and delivers the administration use-cases. Several implementation-level choices
were open. Product-level policies that remain undecided are listed at the end;
this ADR only fixes reversible engineering defaults.

## Decisions

### 1. Better Auth containment

- Better Auth 1.7.1 with the Drizzle adapter, self-hosted, on tables
  `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`
  (migration `0002`). These tables are provider infrastructure: **no domain
  code reads or writes them**; only `src/auth/*` touches Better Auth.
- The Better Auth *organization plugin is not used* — organizations,
  memberships, roles, and branch access are blueprint tables owned by the
  identity module.
- Link into the domain: `core_users.auth_subject` stores the provider user id
  as opaque text. **No foreign key** to `auth_users`, so the provider remains
  swappable (ADR 0003 reversibility).
- Telemetry disabled.

### 2. Interim authentication defaults (product policy still NEEDS DECISION)

- Email + password enabled — the only method that needs no email vendor.
- No email verification, no magic links, no MFA yet (transport/vendor and
  policy are NEEDS DECISION in ADR 0003; adding them later is additive).
- `autoSignIn` disabled: admin-provisioned accounts never mint sessions, and
  `last_login_at` stays truthful (set by a session-create hook).

### 3. Core User provisioning

- A Core User row is created by a Better Auth `user.create` hook at sign-up
  and re-synced (email/display name) on each authenticated request as a safety
  net. A Core User row alone grants **no** organization access — only
  memberships do.
- `core_users.status != 'ACTIVE'` blocks every request even with a valid
  provider session. Only org-level suspension is exposed in admin APIs;
  global user disabling is a platform concern (NEEDS DECISION, ADR 0004).

### 4. Organization selection

- The selected organization id lives in an httpOnly `gc_organization_id`
  cookie. The cookie is a **selector, never an authority**: every request
  re-resolves `authenticated user → ACTIVE membership → organization` server
  side. A tampered cookie can only produce 403.
-   `withTenant` sets transaction-local `app.user_id`. RLS policies on
  `core_organization_memberships` / `core_organizations` were refined
  (migrations `0002` and `0003`) so a user can read *their own* memberships and those
  organizations before selecting one — without any request-path RLS bypass.
  Writes remain organization-scoped. A user may update their own membership
  row only for INVITED → ACTIVE invitation activation; `organization_id` and
  `user_id` are immutable at the database.

### 5. Organization creation (self-serve, reversible default)

- Any authenticated user may create an organization and becomes its first
  administrator. Rationale: the blueprint defines no platform provisioning
  flow and a platform-admin surface is NEEDS DECISION (ADR 0004); self-serve
  is testable and cheap to restrict later.
- Creation seeds an `is_system` OWNER role granted **every permission in the
  current registry** and assigns it to the creator (ACTIVE membership,
  `joined_at` set). Future migrations that add permission codes must decide
  whether to backfill system OWNER roles.

### 6. Roles, permissions, and safety invariants

- Authorization is permission-based (`core.*` codes); role names are never
  checked in the security path.
- System roles (`is_system`) cannot be renamed, archived, or re-permissioned.
- **Anti-escalation:** nobody can assign a role, or add a permission to a
  role, that includes permissions they do not themselves hold.
- **Last-admin invariant:** after any mutation that reduces administrative
  capability (suspend membership, remove role assignment, archive role, edit
  role permissions), the organization must retain ≥ 1 ACTIVE membership of an
  ACTIVE user whose effective permissions include `core.memberships.manage`
  **and** `core.roles.manage`. Enforced in-transaction (violations roll the
  mutation back) behind a `FOR UPDATE` lock on the organization row, which
  serializes concurrent admin-reducing mutations and prevents write-skew
  (two parallel suspends removing both admins). Permission-based on purpose —
  no `role === "OWNER"` checks.
- Owner/Manager/Cashier *template permission sets* beyond OWNER are NEEDS
  DECISION; only OWNER is seeded.

### 7. Memberships

- Admin creates accounts directly (email + initial password + ACTIVE
  membership) because no invitation email transport exists yet.
- Existing accounts are attached by email as INVITED; the invited user
  accepts by entering the organization (self-consent activation sets
  `joined_at`). Suspension covers both revoking invitations and blocking
  members; reactivation returns to ACTIVE or INVITED based on `joined_at`.
- Memberships are never physically deleted in this milestone.

### 8. Branch access

- `core_branch_access` grants (VIEW < OPERATE < MANAGE) are managed under
  `core.memberships.manage` (branch access is user-access administration;
  roles grant capabilities, branch access grants places — SEC-015/016).
- Creating a branch auto-grants the creating membership MANAGE on it, so a
  branch can never be born unreachable.

### 9. HTTP and audit

- Route handlers are thin: parse (zod) → resolve context → call identity
  use-case → map domain errors to 400/401/403/404/409. All enforcement lives
  in `src/auth/context.ts` + `src/modules/identity/*`.
- Every identity/admin mutation writes `core_audit_logs` in the same
  transaction (who / what / which organization / which branch / before /
  after). No secrets are logged.
- Session cookies are SameSite=Lax (Better Auth default). Admin JSON mutation
  routes additionally reject a mismatched `Origin`. This is **not** full CSRF
  protection; see ADR 0008 before introducing cross-origin admin clients.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Better Auth organization plugin | Duplicates blueprint-owned membership/role tables |
| FK `core_users.auth_subject → auth_users.id` | Couples domain to provider; blocks IdP swap |
| Storing selected org in Better Auth session table | Leaks domain concept into provider internals |
| `SECURITY DEFINER` helper for pre-selection reads | Policy refinement is declarative and narrower |
| Hard-coded `role === "OWNER"` safety checks | Role names must not become the security engine |
| Email-based invitations | Email transport vendor is NEEDS DECISION |

## Consequences

- Swapping the auth provider later means migrating `auth_subject` values and
  replacing `src/auth` only.
- Admin UI is minimal and unbranded by design; Gaming Floor UX comes later.
- New modules must register their permission codes via migration and decide
  OWNER backfill explicitly.
- Platform adaptation (2026-08-28): public HTTP sign-up and HTTP organization
  create are fail-closed after the first owner/org (`0012_platform_bootstrap.sql`).
  In-process `auth.api.signUpEmail` and domain `createOrganization` remain for
  staff provisioning and tests. Multi-tenant self-serve onboarding stays
  NEEDS DECISION (platform-admin).

## Open questions (NEEDS DECISION)

- Final authentication policy: passwords vs magic links vs both; MFA;
  password reset flow (needs email transport); session lifetime policy.
- Invitation email transport and platform provisioning / platform-admin.
- Manager/Cashier role template permission sets.
- Organization suspension/archival triggers and UI (platform concern).
- Rate limiting posture for admin/auth endpoints beyond Better Auth defaults.
