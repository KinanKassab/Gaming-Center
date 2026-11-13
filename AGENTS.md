# Agent and developer instructions — Akodus Gaming Center

This file is mandatory for every developer and AI agent working in this workspace.

## Project purpose

This repository is **Akodus Gaming Center**: a multi-tenant SaaS system for gaming-center businesses.

It is **not** a generic Akodus platform. Do not generalize it into a shared product for other Akodus lines (business cards, loyalty, membership, and so on).

The same software must serve many gaming-center businesses (organizations), each with one or more branches, plus employees, customers, devices, areas, pricing, sessions, POS, inventory, payments, debt, cash shifts, expenses, reporting, permissions, audit history, and configuration.

**Organization** = one gaming-center business / tenant (example: Dragon Gaming).  
**Branch** = one location of that business (example: Jaramana, Mezzeh, Shaalan).  
Organizations must **never** see each other’s data.

## Workspace structure

Workspace root: `E:\AKODUS\01-Products\Gaming-Cards` (this repository).

| Path | Role |
| --- | --- |
| `Code/` | **Application root.** All software lives here (`package.json`, `src/`, `drizzle/`, tests, app docs). |
| `Requirements/` | Business / product specification (what the system must do). |
| `Code/docs/architecture/` | Architecture (how it is designed). Primary human source: the DOCX blueprint. AI/implementation reference: `GAMING_CENTER_BLUEPRINT.md`. |
| `Design & Assets/` | Design resources only. Do not put source code here. |
| `.cursor/rules/` | Permanent Cursor rules for this project. Do **not** create `Code/.cursor/`. |
| `AGENTS.md` | This file. |
| `README.md` | Human entry point. |

Do **not** create application code at the workspace root.  
Do **not** create `Code/Requirements/`.  
Do **not** put source code in `Requirements/` or `Design & Assets/`.

## Architecture references (read before changing design or business behavior)

1. `Code/docs/architecture/Akodus_Gaming_Center_Database_Architecture_Blueprint_v1.1.docx` — primary human-readable architecture source.
2. `Code/docs/architecture/GAMING_CENTER_BLUEPRINT.md` — implementation and AI-agent reference derived from the DOCX. Do not change architectural meaning when syncing.
3. `Code/docs/architecture/PROJECT_STRUCTURE.md` — how `Code/` is laid out.
4. `Code/docs/architecture/DEVELOPMENT_GUIDE.md` — how to install, migrate, test, and extend.
5. `Code/docs/adr/` — architecture decision records.
6. `Code/docs/architecture/IMPLEMENTATION_STATUS.md` — checkpoint only; verify against the repo.
7. `Code/docs/architecture/UX_PRODUCT.md` — UX / Product Consolidation Pass (simplicity-first, auto-codes, wizard, pricing UI adapter).
8. `Requirements/*.md` — what must be built; not how.

## Mandatory tenant isolation

- Shared multi-tenant PostgreSQL. One database, many organizations.
- Every tenant-owned row has `organization_id`.
- Every branch-owned row has `organization_id` **and** `branch_id`.
- Never trust `organization_id` or `branch_id` from the browser. Resolve tenant from the authenticated session, then authorize.
- Cross-tenant foreign keys must be impossible (composite FKs / tenant-aware constraints).
- RLS is defense-in-depth, not a substitute for application authorization.

## Mandatory multi-branch support

- An organization may have 1, 3, or 20 branches in the same software.
- Customers are organization-level (recognizable across that organization’s branches).
- Operational records (sessions, devices, inventory, cash shifts, expenses) keep branch ownership where the blueprint says so.
- Role and branch access are separate: a user may hold a role and still be limited to specific branches.

## Database rules

- PostgreSQL is the authoritative persistent database.
- UUID identifiers. `timestamptz` for instants.
- Integer minor monetary units (`bigint`). Never JavaScript floating-point for persisted money.
- Never silently recalculate historical financial records.
- Every schema change is a migration. Never manually mutate production schema.
- Completed financial records and audit history are not physically deleted.
- Prefer PostgreSQL constraints for enforceable invariants.
- Indexes follow real access patterns.
- Concurrency-sensitive operations use transactions.
- At most one active/paused gaming session may occupy a device (when that domain is implemented).
- Idempotency for retryable financial and mutation operations.

## Financial integrity

Charge ≠ Payment ≠ Debt ≠ Refund. Split payments must remain possible. Idempotent payment retries must not double-apply. Historical snapshots stay authoritative. This milestone does not implement full finance workflows; the rules still apply to any money code you touch.

## Testing expectations

Compilation is not done. For implemented behavior, add unit, integration, database, and authorization tests as appropriate.

Critical invariants (add tests when the feature exists; tenant isolation is required now):

- Tenant A cannot access Tenant B.
- Users cannot access unauthorized branches.
- Two operators cannot start the same device simultaneously.
- Duplicate payment retries do not duplicate financial effects.
- Session pricing stays historically correct; pause/resume billing is correct; device moves preserve sessions; debt reconciles.
- Migrations work from a clean database.

Never delete or weaken tests merely to make them pass.

Before completing a milestone, run available: typecheck, lint, tests, build.

## Future Cards / NFC — do not implement

Physical cards, NFC, QR membership/loyalty, and related `cards_*` / `nfc_*` / `membership_*` / `loyalty_*` tables, APIs, UI, and libraries are **out of MVP**. Keep the architecture compatible; do not build them. See `Requirements/90-Future-Cards-NFC.md`.

## Needs Decision items

If the blueprint or an ADR marks **NEEDS DECISION**, do not invent the answer in code.

- Do not implement a requirement merely because it seems useful.
- Do not assume an unresolved product, security, financial, or vendor choice.
- Document the gap; pick a reversible technical default only when the engineering default is clearly superior and the choice is cheap to reverse.
- Expensive-to-reverse decisions stay NEEDS DECISION until a human approves them.

## Hard “never” list

- Never implement a requirement merely because it seems useful.
- Never generalize Gaming Center into a universal Akodus platform.
- Never implement Future Cards/NFC functionality without explicit approval.
- Never put secrets in git, the browser, or logs (passwords, tokens, complete credentials).
- Never introduce microservices, Kafka, Redis-as-requirement, GraphQL, Kubernetes, or mandatory Docker in this foundation.
- Never put domain logic in React UI components as the source of truth.
- Never create commits or push unless a human explicitly asks.

## How to continue work

1. Identify whether the change is product behavior (`Requirements/`) or design (`Code/docs/architecture/` + ADRs).
2. Stay inside the module that owns the data. Do not mutate another module’s tables without an explicit domain contract.
3. Add or extend a migration; add tests that include tenant isolation where data is tenant-owned.
4. Follow `Code/docs/architecture/DEVELOPMENT_GUIDE.md`.

## Recovery / resume (mandatory after interruption)

If work resumes after interruption, or the user says **continue**, **resume**, **كمل**, **تابع**, or **كمل من وين وقفت**, do this **before editing**:

1. Inspect the actual repository (filesystem is source of truth).
2. Inspect `git status` (and whether Git exists).
3. Read `Code/docs/architecture/IMPLEMENTATION_STATUS.md`.
4. Verify its claims against the repository; do not trust the checkpoint blindly.
5. Determine the current milestone.
6. Classify work as completed / partial / remaining / blocked.
7. Re-run relevant verification (typecheck, lint, tests, build as applicable).
8. Resume from the earliest incomplete **safe** dependency.
9. Preserve correct completed work. Do not recreate the blueprint or duplicate files.
10. Never duplicate migrations or files merely because a previous agent stopped.

If context or execution limits are approaching:

- Finish the current safe atomic operation.
- Avoid half-written migrations or refactors.
- Update `IMPLEMENTATION_STATUS.md`.
- Leave an exact resume point.
