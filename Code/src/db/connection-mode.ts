/**
 * PostgreSQL connection classification for local PostgreSQL and hosted
 * Supabase (Supavisor). Not a generic cloud-database framework.
 *
 * Tenant/security state must never depend on connection identity across
 * requests. Supavisor transaction pooling may reuse backends between
 * transactions; GUC must stay transaction-local (see withTenant).
 */

import { RUNTIME_DB_ROLE } from "@/db/runtime-role";

export const CONNECTION_MODES = {
  LOCAL_OR_DIRECT: "LOCAL_OR_DIRECT",
  SUPABASE_TRANSACTION_POOLER: "SUPABASE_TRANSACTION_POOLER",
  SUPABASE_SESSION_POOLER: "SUPABASE_SESSION_POOLER",
  SUPABASE_DIRECT: "SUPABASE_DIRECT",
} as const;

export type ConnectionMode = (typeof CONNECTION_MODES)[keyof typeof CONNECTION_MODES];

export type ConnectionIdentity = {
  user: string;
  host: string;
  port: string;
  database: string;
};

/** Catalog role name we must see as current_user on the runtime path. */
export const RUNTIME_CATALOG_ROLE = RUNTIME_DB_ROLE;

/**
 * Privileged / platform usernames that must never appear as DATABASE_URL.
 * Checked against the catalog role (the part before "." on a pooler username).
 */
export const UNSAFE_RUNTIME_CATALOG_ROLES = new Set([
  "postgres",
  "migrator",
  "rds_superuser",
  "azure_pg_admin",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_storage_admin",
  "authenticator",
  "service_role",
  "anon",
  "authenticated",
  "dashboard_user",
  "pgbouncer",
  "supabase_etl_admin",
  "supabase_realtime_admin",
  "supabase_replication_admin",
]);

/** Supabase project refs are lowercase alphanumeric (typically 20 chars). */
export const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{10,32}$/;

export const DEFAULT_RUNTIME_POOL_MAX = 2;
export const MAX_RUNTIME_POOL_MAX = 4;

type EnvBag = Record<string, string | undefined>;

export class ConnectionModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionModeError";
  }
}

function hostname(host: string): string {
  return host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

export function isSupabasePoolerHost(host: string): boolean {
  const value = hostname(host);
  return value.endsWith(".pooler.supabase.com") && value !== "pooler.supabase.com";
}

export function isSupabaseDirectHost(host: string): boolean {
  return /^db\.[a-z0-9]{10,32}\.supabase\.co$/i.test(hostname(host));
}

export function isRecognizedSupabaseHost(host: string): boolean {
  return isSupabasePoolerHost(host) || isSupabaseDirectHost(host);
}

export function portNumber(port: string): number {
  const trimmed = port.trim();
  const value = trimmed === "" ? 5432 : Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConnectionModeError("Database URL port is invalid");
  }
  return value;
}

export function classifyPostgresConnection(identity: ConnectionIdentity): ConnectionMode {
  const host = hostname(identity.host);
  const port = portNumber(identity.port);
  if (isSupabasePoolerHost(host)) {
    if (port === 6543) return CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER;
    if (port === 5432) return CONNECTION_MODES.SUPABASE_SESSION_POOLER;
    throw new ConnectionModeError(
      `Unrecognized Supabase pooler port ${port}. Transaction pooler is 6543; session pooler is 5432.`,
    );
  }
  if (isSupabaseDirectHost(host)) {
    if (port === 5432) return CONNECTION_MODES.SUPABASE_DIRECT;
    throw new ConnectionModeError(
      `Unrecognized Supabase direct port ${port}. Direct PostgreSQL is db.<project-ref>.supabase.co:5432.`,
    );
  }
  return CONNECTION_MODES.LOCAL_OR_DIRECT;
}

/**
 * Catalog role implied by a URL username.
 * Pooler usernames are `role.projectref`; the PostgreSQL role is `role`.
 */
export function catalogRoleFromUrlUser(user: string, mode: ConnectionMode): string {
  const trimmed = user.trim();
  if (!trimmed) return "";
  const pooler =
    mode === CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER ||
    mode === CONNECTION_MODES.SUPABASE_SESSION_POOLER;
  if (pooler) {
    const dot = trimmed.indexOf(".");
    if (dot > 0) return trimmed.slice(0, dot);
  }
  return trimmed;
}

export function poolerProjectRefFromUrlUser(user: string): string | null {
  const trimmed = user.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0) return null;
  const suffix = trimmed.slice(dot + 1);
  if (!SUPABASE_PROJECT_REF_PATTERN.test(suffix)) return null;
  if (suffix.includes(".")) return null;
  return suffix;
}

export function projectRefFromDirectHost(host: string): string | null {
  const match = hostname(host).match(/^db\.([a-z0-9]{10,32})\.supabase\.co$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function extractSupabaseProjectRef(identity: ConnectionIdentity): string | null {
  const mode = classifyPostgresConnection(identity);
  if (mode === CONNECTION_MODES.SUPABASE_DIRECT) {
    return projectRefFromDirectHost(identity.host);
  }
  if (
    mode === CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER ||
    mode === CONNECTION_MODES.SUPABASE_SESSION_POOLER
  ) {
    return poolerProjectRefFromUrlUser(identity.user);
  }
  return null;
}

/** True when DATABASE_URL is a recognized hosted Supabase endpoint, not local PostgreSQL. */
export function isSupabaseRuntimeMode(mode: ConnectionMode): boolean {
  return mode !== CONNECTION_MODES.LOCAL_OR_DIRECT;
}

/**
 * URL username is preliminary. getSafeRuntimeDb() still verifies current_user.
 *
 * Accepts:
 * - `gaming_app` on ordinary/direct PostgreSQL (and Supabase direct)
 * - `gaming_app.<project-ref>` ONLY on a recognized Supabase pooler host
 */
export function assertAcceptedRuntimeDatabaseUser(
  identity: ConnectionIdentity,
  expectedCatalogRole = RUNTIME_CATALOG_ROLE,
): { mode: ConnectionMode; catalogRole: string; projectRef: string | null } {
  const mode = classifyPostgresConnection(identity);
  const user = identity.user.trim();
  if (!user) {
    throw new ConnectionModeError("DATABASE_URL must include the runtime role user");
  }

  const catalogRole = catalogRoleFromUrlUser(user, mode);
  if (UNSAFE_RUNTIME_CATALOG_ROLES.has(catalogRole.toLowerCase())) {
    throw new ConnectionModeError(
      `DATABASE_URL must not use privileged or platform role "${catalogRole}". Runtime is ${expectedCatalogRole} only.`,
    );
  }

  if (catalogRole !== expectedCatalogRole) {
    throw new ConnectionModeError(
      `DATABASE_URL user must be "${expectedCatalogRole}" (or "${expectedCatalogRole}.<project-ref>" on a Supabase pooler host). Connected role is checked again as current_user.`,
    );
  }

  const pooler =
    mode === CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER ||
    mode === CONNECTION_MODES.SUPABASE_SESSION_POOLER;

  if (user === expectedCatalogRole) {
    if (pooler) {
      throw new ConnectionModeError(
        `Supabase pooler DATABASE_URL user must be "${expectedCatalogRole}.<project-ref>", not "${expectedCatalogRole}" alone.`,
      );
    }
    return { mode, catalogRole, projectRef: extractSupabaseProjectRef(identity) };
  }

  // Suffix form: gaming_app.<project-ref>
  if (!pooler) {
    throw new ConnectionModeError(
      `DATABASE_URL user "${user}" is only valid on a recognized Supabase pooler host (*.pooler.supabase.com), not on ${identity.host}.`,
    );
  }

  const projectRef = poolerProjectRefFromUrlUser(user);
  if (!projectRef || user !== `${expectedCatalogRole}.${projectRef}`) {
    throw new ConnectionModeError(
      `DATABASE_URL pooler user must be "${expectedCatalogRole}.<project-ref>" with a valid Supabase project ref. Arbitrary suffixes are rejected.`,
    );
  }

  return { mode, catalogRole, projectRef };
}

export function assertUrlMatchesProjectRef(identity: ConnectionIdentity, expectedRef: string): void {
  const wanted = expectedRef.trim().toLowerCase();
  if (!SUPABASE_PROJECT_REF_PATTERN.test(wanted)) {
    throw new ConnectionModeError("GAMING_SUPABASE_PROJECT_REF is not a valid Supabase project ref");
  }
  const actual = extractSupabaseProjectRef(identity);
  if (actual !== wanted) {
    throw new ConnectionModeError(
      "Database URL project ref does not match GAMING_SUPABASE_PROJECT_REF. Refusing to start against an unexpected Supabase project.",
    );
  }
}

export function assertMigrationConnectionAllowed(identity: ConnectionIdentity): void {
  const mode = classifyPostgresConnection(identity);
  if (mode === CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER) {
    throw new ConnectionModeError(
      "MIGRATION_DATABASE_URL must not use the Supavisor transaction pooler (port 6543). Use the direct db.<project-ref>.supabase.co:5432 endpoint, or the session pooler (port 5432) when IPv4 requires it.",
    );
  }
}

export function assertBackupConnectionAllowed(identity: ConnectionIdentity): void {
  const mode = classifyPostgresConnection(identity);
  if (mode === CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER) {
    throw new ConnectionModeError(
      "Backup connections must not use the Supavisor transaction pooler. Use a direct PostgreSQL endpoint (or session pooler) with a dedicated BYPASSRLS backup role.",
    );
  }
  const catalogRole = catalogRoleFromUrlUser(identity.user, mode);
  if (catalogRole === RUNTIME_CATALOG_ROLE || identity.user.startsWith(`${RUNTIME_CATALOG_ROLE}.`)) {
    throw new ConnectionModeError(
      "Backup connections must not use the runtime gaming_app URL. FORCE RLS blocks dumps for that role.",
    );
  }
}

export function runtimePoolMax(env: EnvBag = process.env): number {
  const raw = env.DATABASE_POOL_MAX?.trim();
  if (!raw) return DEFAULT_RUNTIME_POOL_MAX;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_RUNTIME_POOL_MAX) {
    throw new ConnectionModeError(
      `DATABASE_POOL_MAX must be an integer from 1 to ${MAX_RUNTIME_POOL_MAX} (default ${DEFAULT_RUNTIME_POOL_MAX}). Supavisor already pools server-side; Vercel instances must not open large client pools.`,
    );
  }
  return value;
}

export type RuntimePostgresOptions = {
  max: number;
  prepare: false;
  idle_timeout: number;
  connect_timeout: number;
  ssl?: "require";
};

/**
 * Runtime postgres.js options for every environment.
 *
 * prepare: false — Supavisor transaction mode does not support prepared
 * statements. Local PostgreSQL accepts simple-query protocol, so one setting
 * avoids vendor branching on the request path.
 *
 * max defaults to 2 — each Vercel Function instance would otherwise multiply a
 * large driver pool against Supavisor. Concurrent cashiers are separate
 * invocations; one request is sequential (auth then one withTenant transaction).
 * Cap is 4.
 */
export function runtimePostgresClientOptions(
  identity: ConnectionIdentity,
  env: EnvBag = process.env,
): RuntimePostgresOptions {
  const mode = classifyPostgresConnection(identity);
  const options: RuntimePostgresOptions = {
    max: runtimePoolMax(env),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  };
  if (mode !== CONNECTION_MODES.LOCAL_OR_DIRECT) {
    options.ssl = "require";
  }
  return options;
}

export function migrationPostgresClientOptions(identity: ConnectionIdentity): {
  max: 1;
  ssl?: "require";
} {
  assertMigrationConnectionAllowed(identity);
  const mode = classifyPostgresConnection(identity);
  if (mode === CONNECTION_MODES.LOCAL_OR_DIRECT) {
    return { max: 1 };
  }
  return { max: 1, ssl: "require" };
}
