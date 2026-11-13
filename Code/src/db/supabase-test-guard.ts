/**
 * Fail-closed guard for hosted Supabase compatibility tests.
 *
 * Independent from the local disposable harness (`gaming_center_security_test`).
 * Never DROP DATABASE. Never destroy Supabase-managed schemas.
 */

import { parseDatabaseUrl, type ParsedDatabaseUrl } from "@/core/env";
import {
  CONNECTION_MODES,
  classifyPostgresConnection,
  extractSupabaseProjectRef,
  isRecognizedSupabaseHost,
  SUPABASE_PROJECT_REF_PATTERN,
  type ConnectionMode,
} from "@/db/connection-mode";

export const SUPABASE_TEST_MUTATION_FLAG = "GAMING_SUPABASE_TEST_ALLOW_MUTATION";

export type SupabaseTestDecision =
  | {
      allowed: true;
      projectRef: string;
      migrationMode: ConnectionMode;
      runtimeMode: ConnectionMode;
    }
  | { allowed: false; reason: string };

function fail(reason: string): SupabaseTestDecision {
  return { allowed: false, reason };
}

function parseOrFail(url: string | undefined, name: string): ParsedDatabaseUrl | { error: string } {
  const trimmed = url?.trim();
  if (!trimmed) return { error: `${name} is not set` };
  try {
    return parseDatabaseUrl(trimmed);
  } catch {
    return { error: `${name} is malformed` };
  }
}

export function evaluateSupabaseHostedTestGuard(input: {
  migrationUrl: string | undefined;
  runtimeUrl: string | undefined;
  projectRef: string | undefined;
  allowMutation: string | undefined;
}): SupabaseTestDecision {
  const expectedRef = input.projectRef?.trim().toLowerCase();
  if (!expectedRef || !SUPABASE_PROJECT_REF_PATTERN.test(expectedRef)) {
    return fail("GAMING_SUPABASE_TEST_PROJECT_REF is missing or not a valid Supabase project ref");
  }

  const migration = parseOrFail(input.migrationUrl, "GAMING_SUPABASE_TEST_DATABASE_URL");
  if ("error" in migration) return fail(migration.error);
  const runtime = parseOrFail(input.runtimeUrl, "GAMING_SUPABASE_TEST_RUNTIME_DATABASE_URL");
  if ("error" in runtime) return fail(runtime.error);

  if (!isRecognizedSupabaseHost(migration.host)) {
    return fail("GAMING_SUPABASE_TEST_DATABASE_URL host is not a recognized Supabase host");
  }
  if (!isRecognizedSupabaseHost(runtime.host)) {
    return fail("GAMING_SUPABASE_TEST_RUNTIME_DATABASE_URL host is not a recognized Supabase host");
  }

  let migrationMode: ConnectionMode;
  let runtimeMode: ConnectionMode;
  try {
    migrationMode = classifyPostgresConnection(migration);
    runtimeMode = classifyPostgresConnection(runtime);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "connection classification failed");
  }

  if (migrationMode === CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER) {
    return fail(
      "GAMING_SUPABASE_TEST_DATABASE_URL must not use the transaction pooler. Use direct PostgreSQL or the session pooler.",
    );
  }

  if (runtimeMode !== CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER) {
    return fail(
      "GAMING_SUPABASE_TEST_RUNTIME_DATABASE_URL must be the Supabase transaction pooler (*.pooler.supabase.com port 6543) to test Vercel runtime semantics.",
    );
  }

  const migrationRef = extractSupabaseProjectRef(migration);
  const runtimeRef = extractSupabaseProjectRef(runtime);
  if (migrationRef !== expectedRef) {
    return fail("GAMING_SUPABASE_TEST_DATABASE_URL project ref does not match GAMING_SUPABASE_TEST_PROJECT_REF");
  }
  if (runtimeRef !== expectedRef) {
    return fail(
      "GAMING_SUPABASE_TEST_RUNTIME_DATABASE_URL project ref does not match GAMING_SUPABASE_TEST_PROJECT_REF",
    );
  }
  if (migrationRef !== runtimeRef) {
    return fail("Migration and runtime URLs do not belong to the same Supabase project");
  }

  if (input.allowMutation !== "true") {
    return fail(
      `${SUPABASE_TEST_MUTATION_FLAG}=true is required before mutating the hosted test project. Reachability is not treated as permission.`,
    );
  }

  return {
    allowed: true,
    projectRef: expectedRef,
    migrationMode,
    runtimeMode,
  };
}

export function assertSupabaseHostedTestAllowed(input: {
  migrationUrl: string | undefined;
  runtimeUrl: string | undefined;
  projectRef: string | undefined;
  allowMutation: string | undefined;
}): Extract<SupabaseTestDecision, { allowed: true }> {
  const decision = evaluateSupabaseHostedTestGuard(input);
  if (!decision.allowed) {
    throw new Error(`REFUSED HOSTED SUPABASE TEST: ${decision.reason}`);
  }
  return decision;
}

/**
 * Wipe application objects in public only. Skip extension-owned objects.
 * Never DROP DATABASE. Never DROP SCHEMA auth/storage/realtime/extensions.
 */
export const RESET_PUBLIC_APPLICATION_OBJECTS_SQL = `
DO $reset$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_extension e ON d.refobjid = e.oid
        WHERE d.objid = c.oid
      )
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
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
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_extension e ON d.refobjid = e.oid
        WHERE d.objid = c.oid
      )
  LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;

  FOR r IN
    SELECT p.oid, p.prokind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_extension e ON d.refobjid = e.oid
        WHERE d.objid = p.oid
      )
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
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_extension e ON d.refobjid = e.oid
        WHERE d.objid = t.oid
      )
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END
$reset$;
`;
