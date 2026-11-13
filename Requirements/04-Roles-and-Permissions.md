# 04 — Roles and permissions

Source: Blueprint v1.1 §§3, §7, §9.

Authentication (who is this user?) is not the same as authorization (what may they do, and in which branches?).

| ID | Requirement | Status |
| --- | --- | --- |
| SEC-010 | User identity is system-level (`core_users`). Passwords are not stored in the app table if an auth provider holds them. `auth_subject` links to the auth system. | MVP |
| SEC-011 | Organization access is via **membership**, not by putting `organization_id` on the user row. | MVP |
| SEC-012 | Roles are per organization (templates such as Owner / Manager / Cashier, not frozen hard-coded role rows as the only mechanism). | MVP |
| SEC-013 | Permissions are a system registry (e.g. `gaming.sessions.start`). Modules seed their own codes. | MVP |
| SEC-014 | A membership may have multiple roles. Effective permissions = union of role permissions (deny rules only if added later). | MVP |
| SEC-015 | **Role ≠ branch access.** A manager may hold a high role and still be limited to two branches. | MVP |
| SEC-016 | Branch access is explicit (`core_branch_access`) with an access mode (VIEW / OPERATE / MANAGE, or a simpler model if product later chooses one). | MVP / NEEDS DECISION on exact mode enum if simplified |
| SEC-017 | Privileged API path: authenticate → resolve organization → resolve branch access → authorize permission → validate → transaction → audit. | MVP |
| SEC-018 | UI hiding is not security. The server must reject unauthorized operations. | MVP |

## Permission examples (blueprint)

| Code | Risk | Note |
| --- | --- | --- |
| `gaming.sessions.start` | MEDIUM | Occupies a device and creates financial commitment |
| `gaming.sessions.cancel` | HIGH | Reason + audit |
| `gaming.sessions.discount` | HIGH | May require manager approval later |
| `finance.payments.create` | HIGH | Affects debt and cash |
| `finance.shifts.close` | HIGH | Documents cash difference |
| `inventory.adjust` | HIGH | Changes quantity without sale |
| `settings.manage` | HIGH | Can change prices and rules |
| `reports.financial.view` | MEDIUM/HIGH | Sensitive |

Auth provider / MFA / session implementation: **NEEDS DECISION** (see ADR 0003). Organization, branch, and permission models remain in this application regardless of provider.
