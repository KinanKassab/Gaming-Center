import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";
import { parseDatabaseUrl } from "@/core/env";
import { runtimePostgresClientOptions } from "@/db/connection-mode";
import {
  assertPinnedRuntimeRoleAttributes,
  expectedRuntimeDbRole,
  mapPgRoleRow,
  type RuntimeRoleAttributes,
} from "@/db/runtime-role";

export {
  RUNTIME_DB_ROLE,
  expectedRuntimeDbRole,
  type RuntimeRoleAttributes,
} from "@/db/runtime-role";

/** Domain tables plus authentication-provider tables. */
export const appSchema = { ...schema, ...authSchema };

export type AppSchema = typeof appSchema;

export type AppDatabase = PostgresJsDatabase<AppSchema> | PgliteDatabase<AppSchema>;

const runtimeDb = new AsyncLocalStorage<AppDatabase>();

/**
 * Request/test override so HTTP handlers and Next.js pages can run against a
 * disposable database without reading DATABASE_URL. Production request handling
 * never sets this — it uses the singleton connected as gaming_app.
 */
export function runWithRuntimeDb<T>(db: AppDatabase, fn: () => T): T {
  return runtimeDb.run(db, fn);
}

/** postgres.js client for the HTTP runtime. Always `prepare: false` (Supavisor transaction mode). */
export function createRuntimeSql(databaseUrl: string) {
  const identity = parseDatabaseUrl(databaseUrl);
  return postgres(databaseUrl, runtimePostgresClientOptions(identity));
}

export function createPostgresClient(databaseUrl: string) {
  return drizzle(createRuntimeSql(databaseUrl), { schema: appSchema });
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. It must be the restricted runtime role (gaming_app). Copy .env.example to .env.",
    );
  }
  return url;
}

export function requireMigrationDatabaseUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL is not set. Migrations must use a privileged connection, never the runtime gaming_app URL.",
    );
  }
  return url;
}

/**
 * Inspect the connected role. Used at request startup and in security tests.
 * Fail closed: missing pg_roles row is treated as unsafe.
 */
function firstExecuteRow<T extends Record<string, unknown>>(result: unknown): T | undefined {
  if (Array.isArray(result)) return result[0] as T | undefined;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: T[] }).rows;
    return rows[0];
  }
  return undefined;
}

export async function readRuntimeRoleAttributes(db: AppDatabase): Promise<RuntimeRoleAttributes> {
  const result = await db.execute(sql`
    SELECT current_user AS current_user,
           COALESCE(rolsuper, false) AS rolsuper,
           COALESCE(rolbypassrls, false) AS rolbypassrls,
           COALESCE(rolcreatedb, false) AS rolcreatedb,
           COALESCE(rolcreaterole, false) AS rolcreaterole,
           COALESCE(rolinherit, false) AS rolinherit,
           COALESCE(rolcanlogin, false) AS rolcanlogin
    FROM pg_roles
    WHERE rolname = current_user
  `);
  const row = firstExecuteRow<{
    current_user: string;
    rolsuper: unknown;
    rolbypassrls: unknown;
    rolcreatedb: unknown;
    rolcreaterole: unknown;
    rolinherit: unknown;
    rolcanlogin: unknown;
  }>(result);
  if (!row) {
    throw new Error("Could not resolve current database role from pg_roles");
  }
  const named = mapPgRoleRow({
    rolname: String(row.current_user),
    rolsuper: row.rolsuper,
    rolbypassrls: row.rolbypassrls,
    rolcreatedb: row.rolcreatedb,
    rolcreaterole: row.rolcreaterole,
    rolinherit: row.rolinherit,
    rolcanlogin: row.rolcanlogin,
  });
  return { ...named, currentUser: named.roleName };
}

/**
 * Request-path safety: connected role must be the restricted runtime role
 * (NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN).
 */
export async function assertRuntimeDatabaseRole(db: AppDatabase): Promise<RuntimeRoleAttributes> {
  const attributes = await readRuntimeRoleAttributes(db);
  const expected = expectedRuntimeDbRole();
  if (attributes.currentUser !== expected) {
    throw new Error(
      `Unsafe runtime database role: connected as "${attributes.currentUser}", expected "${expected}". DATABASE_URL must use the restricted request role, not a superuser, owner, or BYPASSRLS role.`,
    );
  }
  assertPinnedRuntimeRoleAttributes(attributes, expected);
  return attributes;
}

declare global {
  // Cached across hot reloads in development so connection pools are not duplicated.
  var __gamingCenterDb: AppDatabase | undefined;
  var __gamingCenterRuntimeSafety: Promise<RuntimeRoleAttributes> | undefined;
}

function beginRuntimeSafetyCheck(db: AppDatabase): Promise<RuntimeRoleAttributes> {
  if (!globalThis.__gamingCenterRuntimeSafety) {
    globalThis.__gamingCenterRuntimeSafety = assertRuntimeDatabaseRole(db).catch((error: unknown) => {
      globalThis.__gamingCenterDb = undefined;
      globalThis.__gamingCenterRuntimeSafety = undefined;
      throw error;
    });
  }
  return globalThis.__gamingCenterRuntimeSafety;
}

/** Lazily created singleton database for the running Next.js server. */
export function getRuntimeDb(): AppDatabase {
  const scoped = runtimeDb.getStore();
  if (scoped) return scoped;
  if (!globalThis.__gamingCenterDb) {
    const db = createPostgresClient(requireDatabaseUrl());
    globalThis.__gamingCenterDb = db;
    void beginRuntimeSafetyCheck(db);
  }
  return globalThis.__gamingCenterDb;
}

/**
 * Request handlers must call this so an unsafe DATABASE_URL fails closed
 * before tenant data is touched.
 */
export async function getSafeRuntimeDb(): Promise<AppDatabase> {
  const scoped = runtimeDb.getStore();
  if (scoped) return scoped;
  const db = getRuntimeDb();
  await beginRuntimeSafetyCheck(db);
  return db;
}
