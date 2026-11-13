# ADR 0003 — Authentication strategy

- Status: Accepted — implemented in Milestone 2 (see ADR 0007 for implementation decisions)
- Date: 2026-08-24 (updated 2026-08-25)

## Context

Authentication answers **who** the user is. Authorization (organization, branch, permissions) stays in this application. The blueprint forbids storing password hashes in `core_users` if an auth provider owns credentials, and forbids a paid-only vendor as a requirement.

## Decision

- **Provider:** [Better Auth](https://www.better-auth.com/) self-hosted, open source, TypeScript. Sessions/credentials live in provider tables (`auth_*`, migration 0002), not in Gaming domain tables.
- **Link:** `core_users.auth_subject` stores the stable subject id from the provider (opaque text, no FK).
- **Milestone 2 implementation:** email+password enabled as an interim default (no email vendor required); Better Auth confined to `src/auth`; see ADR 0007.
- Organization membership, roles, branch access, and permission checks remain **our** tables and code.

## Alternatives considered

| Option | Why not as default |
| --- | --- |
| Clerk / Auth0 / Cognito as mandatory | Paid vendor lock-in |
| Auth.js (NextAuth) | Viable; Better Auth maps more directly to our own Postgres |
| Custom password table in `core_users` | Conflicts with blueprint “provider owns passwords” |
| Magic-link only | Product has not decided |

## Consequences

- Do not treat `core_users` as a complete IdP.
- Never trust `x-organization-id` from the browser as identity.

## Reversibility

High until login ships. After shipping, swapping IdP requires migrating `auth_subject` values.

## Open questions

- Password vs magic link vs both as final product policy — **NEEDS DECISION** (email+password is the reversible interim default)
- MFA — **NEEDS DECISION**
- Invitation email transport — **NEEDS DECISION** (admin-created credentials and self-consent attach flows exist without email; see ADR 0007)
