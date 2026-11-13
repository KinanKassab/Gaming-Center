# Akodus Gaming Center

SaaS for **gaming-center businesses** (multi-tenant, multi-branch). This is not a generic Akodus platform.

| Path | Role |
| --- | --- |
| `Code/` | Application root (`npm install` here) |
| `Requirements/` | What the product must do |
| `Code/docs/architecture/` | How it is designed (`GAMING_CENTER_BLUEPRINT.md` + DOCX) |
| `Code/docs/adr/` | Architecture decisions |
| `AGENTS.md` | Contract for humans and AI agents |
| `.cursor/rules/` | Cursor project rules |

## Current milestone

Milestone 8 — Production hardening & pilot readiness is **CLOSED**. Milestones 1–7 are CLOSED. Milestone 9 (POS catalog / inventory) is **not started**.

Real-money pilot: **CONDITIONAL GO** (not GO). See `Code/docs/operations/PILOT_CHECKLIST.md`.

## Quick start

```bash
cd Code
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Tests use in-process PGlite. A local PostgreSQL server is optional. Copy `Code/.env.example` to `Code/.env` before `npm run db:migrate`.

See `Code/docs/architecture/DEVELOPMENT_GUIDE.md` and `Code/docs/architecture/IMPLEMENTATION_STATUS.md`.
