# Disposable browser verification

The browser fixture is synthetic and destructive. It resets only the local PostgreSQL database named `gaming_center_security_test`. It refuses any other database name or non-loopback host, requires `GAMING_TEST_ALLOW_RESET=true`, and checks `current_database()` before resetting. Never point it at hosted Supabase or a database containing real data.

Prerequisites: a local PostgreSQL instance with the restricted `gaming_app` runtime role, a privileged database owner for migrations and reset, Node dependencies installed, and Google Chrome installed. Set `MIGRATION_DATABASE_URL` and `DATABASE_URL` to that same disposable database. The privileged URL must be able to drop existing tables owned by earlier migrations. No browser test credentials belong in `.env` or production deployment settings.

From `Code/` in PowerShell:

```powershell
$env:GAMING_TEST_ALLOW_RESET = 'true'
npm run browser:fixture
$env:BETTER_AUTH_SECRET = 'synthetic-browser-fixture-secret-never-production-123'
npm run dev
```

In another terminal, also from `Code/`:

```powershell
npm run browser:smoke
npm run browser:responsive
```

The seed creates a primary organization with two branches, two devices, a customer, a priced non-stock drink, an owner, and a limited staff account. A separate synthetic organization, owner, branch, and customer support cross-tenant denial checks. It may be run twice; each run resets the disposable database and produces the same counts. Run the fixture with the application server stopped to avoid open connections to replaced tables. The generated `.tmp-browser-fixture.json` and `.tmp-browser-artifacts/` stay local and are ignored by Git. The scripts use the installed Chrome binary through `playwright-core`, without downloading a browser. Set `BROWSER_CHROME_PATH` only if Chrome is installed elsewhere.

The smoke script covers login in both languages, organization selection, customer create/edit/search/archive, device filtering, session lifecycle, drink sale, checkout, duplicate submission and idempotent retry, staff denials, and logout. The responsive script checks dashboard, floor, customers, an unpaid checkout, and a confirmation dialog in Arabic RTL and English LTR at 1440×900, 1280×720, 1024×768, 768×1024, 390×844, and 375×812. Results and failure screenshots are in `.tmp-browser-artifacts/`.

Use a fresh `browser:fixture` run before final smoke verification. These scripts do not verify hosted deployment, provider payments, inventory, refunds, or cash shifts.
