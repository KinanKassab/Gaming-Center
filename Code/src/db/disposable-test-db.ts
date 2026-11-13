/**
 * Fail-closed guard for destructive live-test cleanup.
 *
 * Reachability is not proof a database is disposable. Reset is allowed only
 * for the approved name, with an explicit opt-in flag, and never for
 * postgres / template0 / template1.
 */

export const APPROVED_DISPOSABLE_TEST_DATABASE = "gaming_center_security_test";

export const FORBIDDEN_RESET_DATABASE_NAMES = ["postgres", "template0", "template1"] as const;

export const DISPOSABLE_TEST_RESET_FLAG = "GAMING_TEST_ALLOW_RESET";

export type DisposableTestResetDecision =
  | { allowed: true; databaseName: string }
  | { allowed: false; reason: string };

function fail(reason: string): DisposableTestResetDecision {
  return { allowed: false, reason };
}

/**
 * Database name from a postgres URL path. Parse failure or a missing name
 * fails closed (returns null) — never infer a disposable target.
 */
export function databaseNameFromPostgresUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.replace(/^postgres(ql)?:/i, "http:");
    const parsed = new URL(normalized);
    const raw = decodeURIComponent(parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, ""));
    if (!raw || raw.includes("/")) return null;
    return raw;
  } catch {
    return null;
  }
}

export function evaluateDisposableTestResetGuard(input: {
  databaseUrl: string | undefined;
  allowReset: string | undefined;
  approvedDatabaseName?: string;
}): DisposableTestResetDecision {
  const approved = input.approvedDatabaseName ?? APPROVED_DISPOSABLE_TEST_DATABASE;
  const url = input.databaseUrl?.trim();
  if (!url) {
    return fail("GAMING_TEST_DATABASE_URL is not set");
  }

  const databaseName = databaseNameFromPostgresUrl(url);
  if (!databaseName) {
    return fail("GAMING_TEST_DATABASE_URL has no usable database name; refusing destructive reset");
  }

  const lower = databaseName.toLowerCase();
  if ((FORBIDDEN_RESET_DATABASE_NAMES as readonly string[]).includes(lower)) {
    return fail(`refusing destructive reset of protected database "${databaseName}"`);
  }

  if (databaseName !== approved) {
    return fail(
      `database "${databaseName}" is not the approved disposable test database "${approved}"`,
    );
  }

  if (input.allowReset !== "true") {
    return fail(
      `${DISPOSABLE_TEST_RESET_FLAG}=true is required before resetting "${approved}". A reachable database is not treated as disposable.`,
    );
  }

  return { allowed: true, databaseName };
}

export function assertDisposableTestResetAllowed(input: {
  databaseUrl: string | undefined;
  allowReset: string | undefined;
  approvedDatabaseName?: string;
}): string {
  const decision = evaluateDisposableTestResetGuard(input);
  if (!decision.allowed) {
    throw new Error(`REFUSED DESTRUCTIVE TEST RESET: ${decision.reason}`);
  }
  return decision.databaseName;
}

export function assertConnectedDatabaseIsApprovedDisposable(
  currentDatabase: string,
  approvedDatabaseName = APPROVED_DISPOSABLE_TEST_DATABASE,
): void {
  if (currentDatabase !== approvedDatabaseName) {
    throw new Error(
      `REFUSED DESTRUCTIVE TEST RESET: current_database() is "${currentDatabase}", expected "${approvedDatabaseName}". The URL name is not enough; the live session must match.`,
    );
  }
  if ((FORBIDDEN_RESET_DATABASE_NAMES as readonly string[]).includes(currentDatabase.toLowerCase())) {
    throw new Error(
      `REFUSED DESTRUCTIVE TEST RESET: current_database() "${currentDatabase}" is protected.`,
    );
  }
}

/** Wipe application objects in public only. Never DROP DATABASE. Never switch databases. */
export const RESET_PUBLIC_SCHEMA_SQL = `
DO $reset$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;

  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;

  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;

  FOR r IN
    SELECT p.oid, p.prokind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    IF r.prokind = 'p' THEN
      EXECUTE format('DROP PROCEDURE IF EXISTS %s CASCADE', r.oid::regprocedure);
    ELSIF r.prokind = 'a' THEN
      EXECUTE format('DROP AGGREGATE IF EXISTS %s CASCADE', r.oid::regprocedure);
    ELSE
      EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.oid::regprocedure);
    END IF;
  END LOOP;

  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('e', 'd')
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END
$reset$;
`;

/**
 * Table owners with FORCE RLS cannot COPY/pg_dump table data. Production
 * backups must use a BYPASSRLS (or superuser) role instead of this switch.
 * Disposable restore drills may suspend FORCE as the table owner only.
 */
export const SUSPEND_FORCE_ROW_SECURITY_SQL = `
DO $suspend$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END
$suspend$;
`;

/** Re-apply FORCE on every public table that already has RLS enabled. */
export const FORCE_ROW_SECURITY_ON_RLS_TABLES_SQL = `
DO $force$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END
$force$;
`;
