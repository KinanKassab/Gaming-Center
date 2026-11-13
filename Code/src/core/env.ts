import { expectedRuntimeDbRole } from "@/db/runtime-role";
import {
  assertAcceptedRuntimeDatabaseUser,
  assertMigrationConnectionAllowed,
  assertUrlMatchesProjectRef,
  CONNECTION_MODES,
  ConnectionModeError,
  isSupabaseRuntimeMode,
  runtimePoolMax,
} from "@/db/connection-mode";

export {
  CONNECTION_MODES,
  classifyPostgresConnection,
  extractSupabaseProjectRef,
  runtimePoolMax,
  runtimePostgresClientOptions,
  type ConnectionMode,
  type ConnectionIdentity,
} from "@/db/connection-mode";

export type ParsedDatabaseUrl = {
  protocol: string;
  user: string;
  host: string;
  port: string;
  database: string;
};

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

export type EnvBag = Record<string, string | undefined>;

export const FIRST_ADMIN_BOOTSTRAP_TOKEN_ENV = "GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN";
export const FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER = "x-gaming-bootstrap-token";
export const MIN_FIRST_ADMIN_BOOTSTRAP_TOKEN_LENGTH = 16;

/**
 * Optional one-time first-owner HTTP sign-up secret. Unset/empty means public
 * bootstrap is disabled. Not required for production startup after bootstrap.
 */
export function configuredFirstAdminBootstrapToken(processEnv: EnvBag = process.env): string | null {
  const raw = processEnv[FIRST_ADMIN_BOOTSTRAP_TOKEN_ENV];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function assertOptionalFirstAdminBootstrapToken(processEnv: EnvBag = process.env): void {
  const configured = configuredFirstAdminBootstrapToken(processEnv);
  if (!configured) return;
  if (configured.length < MIN_FIRST_ADMIN_BOOTSTRAP_TOKEN_LENGTH) {
    throw new EnvironmentError(
      `${FIRST_ADMIN_BOOTSTRAP_TOKEN_ENV} must be at least ${MIN_FIRST_ADMIN_BOOTSTRAP_TOKEN_LENGTH} characters when set`,
    );
  }
}

function nodeEnv(override?: string): string {
  return override ?? process.env.NODE_ENV ?? "development";
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function asEnvironmentError(error: unknown): EnvironmentError {
  if (error instanceof EnvironmentError) return error;
  if (error instanceof ConnectionModeError) return new EnvironmentError(error.message);
  if (error instanceof Error) return new EnvironmentError(error.message);
  return new EnvironmentError(String(error));
}

/**
 * Parse a PostgreSQL URL without returning the password.
 * Malformed values fail closed.
 */
export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new EnvironmentError("Database URL is empty");
  }
  try {
    const normalized = trimmed.replace(/^postgres(ql)?:/i, "http:");
    const parsed = new URL(normalized);
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, ""));
    if (!database || database.includes("/")) {
      throw new EnvironmentError("Database URL has no usable database name");
    }
    const protocol = trimmed.toLowerCase().startsWith("postgresql:") ? "postgresql:" : "postgres:";
    return {
      protocol,
      user: decodeURIComponent(parsed.username || ""),
      host: parsed.hostname,
      port: parsed.port || "5432",
      database,
    };
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    throw new EnvironmentError("Database URL is malformed");
  }
}

/** Redact passwords and secrets for operator-facing messages. Never log the raw URL. */
export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = parseDatabaseUrl(url);
    const user = parsed.user || "(no-user)";
    return `${parsed.protocol}//${user}:***@${parsed.host}:${parsed.port}/${parsed.database}`;
  } catch {
    return "[unparseable-database-url]";
  }
}

export function originFromAppBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new EnvironmentError("APP_BASE_URL is empty");
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new EnvironmentError("APP_BASE_URL must be http or https");
    }
    if (!parsed.hostname) {
      throw new EnvironmentError("APP_BASE_URL has no hostname");
    }
    return parsed.origin;
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    throw new EnvironmentError("APP_BASE_URL is malformed");
  }
}

export function vercelEnvValue(env: EnvBag = process.env): string | undefined {
  const value = env.VERCEL_ENV?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function isVercelPreview(env: EnvBag = process.env): boolean {
  return vercelEnvValue(env) === "preview";
}

export function isVercelProduction(env: EnvBag = process.env): boolean {
  return vercelEnvValue(env) === "production";
}

const VERCEL_APP_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.vercel\.app$/i;

/**
 * HTTPS origin from a Vercel-provided hostname env (VERCEL_URL / VERCEL_BRANCH_URL).
 * These values are hostnames without a scheme. Do not accept Host / X-Forwarded-Host.
 */
export function vercelHttpsOriginFromTrustedHost(raw: string | undefined): string | null {
  const host = raw?.trim().toLowerCase();
  if (!host) return null;
  if (host.includes("/") || host.includes(":") || host.includes("@") || host.includes(" ")) {
    return null;
  }
  if (!VERCEL_APP_HOST.test(host)) return null;
  return `https://${host}`;
}

export function vercelPreviewTrustedOrigins(processEnv: EnvBag = process.env): string[] {
  if (!isVercelPreview(processEnv)) return [];
  const origins: string[] = [];
  const fromUrl = vercelHttpsOriginFromTrustedHost(processEnv.VERCEL_URL);
  const fromBranch = vercelHttpsOriginFromTrustedHost(processEnv.VERCEL_BRANCH_URL);
  if (fromUrl) origins.push(fromUrl);
  if (fromBranch && fromBranch !== fromUrl) origins.push(fromBranch);
  return origins;
}

/**
 * Public origin used by Better Auth as baseURL.
 *
 * Production (including Vercel Production): APP_BASE_URL is required.
 * Vercel Preview: APP_BASE_URL if set, otherwise https://VERCEL_URL (Vercel-provided).
 * Development: APP_BASE_URL or http://localhost:3000.
 */
export function publicAppOrigin(env = process.env.NODE_ENV, processEnv: EnvBag = process.env): string {
  const raw = processEnv.APP_BASE_URL?.trim();
  if (isVercelPreview(processEnv)) {
    if (raw) return originFromAppBaseUrl(raw);
    const fromVercel = vercelHttpsOriginFromTrustedHost(processEnv.VERCEL_URL);
    if (!fromVercel) {
      throw new EnvironmentError(
        "Vercel Preview requires APP_BASE_URL or a valid VERCEL_URL (*.vercel.app). Host headers are not trusted.",
      );
    }
    return fromVercel;
  }
  if (env === "production") {
    if (!raw) {
      throw new EnvironmentError(
        "APP_BASE_URL is required in production. Set the public origin (for example https://gc.example.com). Localhost is not assumed.",
      );
    }
    return originFromAppBaseUrl(raw);
  }
  if (!raw) return "http://localhost:3000";
  return originFromAppBaseUrl(raw);
}

/**
 * Origins allowed for Better Auth trustedOrigins and mutation Origin checks.
 * Production: only APP_BASE_URL's origin.
 * Vercel Preview: APP_BASE_URL (if set) plus Vercel-provided *.vercel.app hosts.
 * Never derived from Host or X-Forwarded-Host.
 */
export function trustedAppOrigins(env = process.env.NODE_ENV, processEnv: EnvBag = process.env): string[] {
  const origins = new Set<string>();
  origins.add(publicAppOrigin(env, processEnv));
  for (const extra of vercelPreviewTrustedOrigins(processEnv)) {
    origins.add(extra);
  }
  return [...origins];
}

function assertProductionAppBaseUrl(processEnv: EnvBag): string {
  if (isVercelPreview(processEnv)) {
    const origin = publicAppOrigin("production", processEnv);
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") {
      throw new EnvironmentError("Vercel Preview origin must be https");
    }
    return origin;
  }
  const raw = processEnv.APP_BASE_URL?.trim();
  if (!raw) {
    throw new EnvironmentError("APP_BASE_URL is required in production");
  }
  const origin = originFromAppBaseUrl(raw);
  const parsed = new URL(origin);
  if (parsed.protocol === "http:" && !isLocalHostname(parsed.hostname)) {
    throw new EnvironmentError(
      "APP_BASE_URL must use https in production unless the host is localhost (local production-start smoke only).",
    );
  }
  if (isVercelProduction(processEnv) && parsed.protocol !== "https:") {
    throw new EnvironmentError("APP_BASE_URL must be an exact HTTPS production origin on Vercel Production");
  }
  return origin;
}

function assertProductionSecret(processEnv: EnvBag): void {
  const secret = processEnv.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new EnvironmentError(
      "BETTER_AUTH_SECRET is required in production. Generate with: openssl rand -base64 32",
    );
  }
  if (secret.length < 32) {
    throw new EnvironmentError("BETTER_AUTH_SECRET must be at least 32 characters in production");
  }
}

function assertRuntimeDatabaseUrl(processEnv: EnvBag, production: boolean): void {
  const url = processEnv.DATABASE_URL?.trim();
  if (!url) {
    if (production) {
      throw new EnvironmentError(
        "DATABASE_URL is required in production and must be the restricted runtime role, not a migration or superuser URL.",
      );
    }
    return;
  }
  const parsed = parseDatabaseUrl(url);
  const expected = expectedRuntimeDbRole();
  try {
    const accepted = assertAcceptedRuntimeDatabaseUser(parsed, expected);
    const vercel = isVercelProduction(processEnv) || isVercelPreview(processEnv);
    if (vercel && accepted.mode !== CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER) {
      throw new EnvironmentError(
        "On Vercel, DATABASE_URL must be the Supabase transaction pooler (*.pooler.supabase.com port 6543) as gaming_app.<project-ref>.",
      );
    }
    const configuredRef = processEnv.GAMING_SUPABASE_PROJECT_REF?.trim();
    // Backend is DATABASE_URL (CONNECTION_MODES). A leftover
    // GAMING_SUPABASE_PROJECT_REF from another env file must not force local
    // PostgreSQL into Supabase mode (BUG-037). Match the ref only when the
    // runtime URL is a recognized Supabase host.
    if (isSupabaseRuntimeMode(accepted.mode)) {
      if (configuredRef) {
        assertUrlMatchesProjectRef(parsed, configuredRef);
      } else if (vercel) {
        throw new EnvironmentError(
          "GAMING_SUPABASE_PROJECT_REF is required on Vercel so the pooler username cannot silently point at another project.",
        );
      }
    }
  } catch (error) {
    throw asEnvironmentError(error);
  }

  const migration = processEnv.MIGRATION_DATABASE_URL?.trim();
  if (migration && migration === url) {
    throw new EnvironmentError(
      "DATABASE_URL must not be the same as MIGRATION_DATABASE_URL. Runtime and migration credentials must be separated.",
    );
  }
}

function assertOptionalMigrationUrl(processEnv: EnvBag): void {
  const raw = processEnv.MIGRATION_DATABASE_URL?.trim();
  if (!raw) return;
  const parsed = parseDatabaseUrl(raw);
  try {
    assertMigrationConnectionAllowed(parsed);
  } catch (error) {
    throw asEnvironmentError(error);
  }
}

function validateOptionalDatabaseUrl(
  name: "DATABASE_URL" | "MIGRATION_DATABASE_URL",
  processEnv: EnvBag,
): void {
  const raw = processEnv[name]?.trim();
  if (!raw) return;
  parseDatabaseUrl(raw);
}

function assertPreviewDatabaseIsolation(processEnv: EnvBag): void {
  if (!isVercelPreview(processEnv)) return;
  if (processEnv.GAMING_PREVIEW_DB_OK !== "true") {
    throw new EnvironmentError(
      "Vercel Preview refuses to start unless GAMING_PREVIEW_DB_OK=true. Set Preview DATABASE_URL to a dedicated non-production Supabase project. Do not copy Production DATABASE_URL into Preview.",
    );
  }
}

/**
 * Production startup fail-closed checks. Development and test only validate
 * URLs that are actually set, so PGlite unit tests stay credential-free.
 *
 * Skipped during `next build` (`NEXT_PHASE=phase-production-build`) so the
 * compile does not require a live database. `next start` still asserts.
 */
export function assertRuntimeEnvironment(options?: {
  nodeEnv?: string;
  nextPhase?: string;
  env?: EnvBag;
}): void {
  const processEnv = options?.env ?? process.env;
  const phase = options?.nextPhase ?? processEnv.NEXT_PHASE;
  if (phase === "phase-production-build") return;

  const env = nodeEnv(options?.nodeEnv);
  validateOptionalDatabaseUrl("DATABASE_URL", processEnv);
  validateOptionalDatabaseUrl("MIGRATION_DATABASE_URL", processEnv);
  assertOptionalMigrationUrl(processEnv);
  try {
    runtimePoolMax(processEnv);
  } catch (error) {
    throw asEnvironmentError(error);
  }
  const appBase = processEnv.APP_BASE_URL?.trim();
  if (appBase) originFromAppBaseUrl(appBase);
  assertOptionalFirstAdminBootstrapToken(processEnv);

  if (env !== "production") return;

  assertProductionSecret(processEnv);
  assertProductionAppBaseUrl(processEnv);
  assertPreviewDatabaseIsolation(processEnv);
  assertRuntimeDatabaseUrl(processEnv, true);
}

export function isProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}
