# Akodus Gaming Center — application

This folder is the **application root**. Run npm commands here.

- Stack: TypeScript, Next.js App Router, PostgreSQL, Drizzle, Vitest, PGlite (tests)
- Schema: `drizzle/*.sql` (source of truth) + `src/db/schema.ts` (typed map)
- Docs: `docs/architecture/`, `docs/adr/`, `docs/operations/`

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

Copy `.env.example` to `.env` for a real PostgreSQL instance (needed for `npm run dev` login flows). Tests do not need it.

Implemented: foundation (M1), identity/admin (M2), configuration/customers (M3), gaming master data (M4), sessions/floor (M5), billing (M6), checkout/payments (M7), production hardening and pilot readiness (M8 CLOSED). Milestone 9 (POS catalog / inventory) is not started. Real-money pilot is **CONDITIONAL GO**. See `docs/architecture/IMPLEMENTATION_STATUS.md` and `docs/operations/PILOT_CHECKLIST.md`.

Do not add Cards/NFC, POS catalog, inventory, refunds, debt ledger, cash shifts, or WebSockets without explicit authorization.
