import { describe, expect, it } from "vitest";
import {
  CONNECTION_MODES,
  assertAcceptedRuntimeDatabaseUser,
  assertBackupConnectionAllowed,
  assertMigrationConnectionAllowed,
  catalogRoleFromUrlUser,
  classifyPostgresConnection,
  extractSupabaseProjectRef,
  isSupabaseRuntimeMode,
  runtimePoolMax,
  runtimePostgresClientOptions,
  ConnectionModeError,
} from "@/db/connection-mode";

const POOLER_HOST = "aws-0-eu-central-1.pooler.supabase.com";
const DIRECT_HOST = "db.abcdefghijklmnopqr.supabase.co";
const REF = "abcdefghijklmnopqr";

describe("postgres connection classification", () => {
  it("classifies local PostgreSQL as LOCAL_OR_DIRECT", () => {
    expect(
      classifyPostgresConnection({
        user: "gaming_app",
        host: "127.0.0.1",
        port: "5432",
        database: "gaming_center_dev",
      }),
    ).toBe(CONNECTION_MODES.LOCAL_OR_DIRECT);
    expect(
      extractSupabaseProjectRef({
        user: "gaming_app",
        host: "127.0.0.1",
        port: "5432",
        database: "gaming_center_dev",
      }),
    ).toBeNull();
    expect(isSupabaseRuntimeMode(CONNECTION_MODES.LOCAL_OR_DIRECT)).toBe(false);
    expect(isSupabaseRuntimeMode(CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER)).toBe(true);
  });

  it("classifies Supabase pooler ports", () => {
    expect(
      classifyPostgresConnection({
        user: `gaming_app.${REF}`,
        host: POOLER_HOST,
        port: "6543",
        database: "postgres",
      }),
    ).toBe(CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER);
    expect(
      classifyPostgresConnection({
        user: `postgres.${REF}`,
        host: POOLER_HOST,
        port: "5432",
        database: "postgres",
      }),
    ).toBe(CONNECTION_MODES.SUPABASE_SESSION_POOLER);
  });

  it("classifies Supabase direct db.<ref>.supabase.co:5432", () => {
    expect(
      classifyPostgresConnection({
        user: "postgres",
        host: DIRECT_HOST,
        port: "5432",
        database: "postgres",
      }),
    ).toBe(CONNECTION_MODES.SUPABASE_DIRECT);
    expect(extractSupabaseProjectRef({ user: "postgres", host: DIRECT_HOST, port: "5432", database: "postgres" })).toBe(
      REF,
    );
  });

  it("accepts gaming_app on local/direct and gaming_app.<ref> only on pooler hosts", () => {
    expect(
      assertAcceptedRuntimeDatabaseUser({
        user: "gaming_app",
        host: "127.0.0.1",
        port: "5432",
        database: "dev",
      }).catalogRole,
    ).toBe("gaming_app");

    const pooled = assertAcceptedRuntimeDatabaseUser({
      user: `gaming_app.${REF}`,
      host: POOLER_HOST,
      port: "6543",
      database: "postgres",
    });
    expect(pooled.catalogRole).toBe("gaming_app");
    expect(pooled.projectRef).toBe(REF);
    expect(pooled.mode).toBe(CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER);
  });

  it("rejects privileged URL users and arbitrary suffixes on arbitrary hosts", () => {
    expect(() =>
      assertAcceptedRuntimeDatabaseUser({
        user: "postgres",
        host: "127.0.0.1",
        port: "5432",
        database: "dev",
      }),
    ).toThrow(ConnectionModeError);
    expect(() =>
      assertAcceptedRuntimeDatabaseUser({
        user: `postgres.${REF}`,
        host: POOLER_HOST,
        port: "6543",
        database: "postgres",
      }),
    ).toThrow(/postgres|privileged/i);
    expect(() =>
      assertAcceptedRuntimeDatabaseUser({
        user: "service_role",
        host: POOLER_HOST,
        port: "6543",
        database: "postgres",
      }),
    ).toThrow(/service_role|privileged/i);
    expect(() =>
      assertAcceptedRuntimeDatabaseUser({
        user: "gaming_app.not-a-ref",
        host: POOLER_HOST,
        port: "6543",
        database: "postgres",
      }),
    ).toThrow(/project ref/i);
    expect(() =>
      assertAcceptedRuntimeDatabaseUser({
        user: `gaming_app.${REF}`,
        host: "evil.example.com",
        port: "6543",
        database: "postgres",
      }),
    ).toThrow(/pooler host/i);
    expect(() =>
      assertAcceptedRuntimeDatabaseUser({
        user: `gaming_app.${REF}`,
        host: DIRECT_HOST,
        port: "5432",
        database: "postgres",
      }),
    ).toThrow(/pooler host/i);
  });

  it("maps pooler username gaming_app.<ref> to catalog role gaming_app", () => {
    expect(
      catalogRoleFromUrlUser(`gaming_app.${REF}`, CONNECTION_MODES.SUPABASE_TRANSACTION_POOLER),
    ).toBe("gaming_app");
    expect(catalogRoleFromUrlUser("gaming_app", CONNECTION_MODES.LOCAL_OR_DIRECT)).toBe("gaming_app");
  });

  it("rejects transaction pooler for migration and backup", () => {
    const txPooler = {
      user: `postgres.${REF}`,
      host: POOLER_HOST,
      port: "6543",
      database: "postgres",
    };
    expect(() => assertMigrationConnectionAllowed(txPooler)).toThrow(/transaction pooler/i);
    expect(() => assertBackupConnectionAllowed(txPooler)).toThrow(/transaction pooler/i);
    expect(() =>
      assertBackupConnectionAllowed({
        user: "gaming_app",
        host: "127.0.0.1",
        port: "5432",
        database: "dev",
      }),
    ).toThrow(/gaming_app/i);
    expect(() =>
      assertMigrationConnectionAllowed({
        user: "postgres",
        host: DIRECT_HOST,
        port: "5432",
        database: "postgres",
      }),
    ).not.toThrow();
  });

  it("uses prepare:false and a small bounded pool", () => {
    expect(runtimePoolMax({})).toBe(2);
    expect(runtimePoolMax({ DATABASE_POOL_MAX: "3" })).toBe(3);
    expect(() => runtimePoolMax({ DATABASE_POOL_MAX: "10" })).toThrow(/1 to 4/);
    const options = runtimePostgresClientOptions({
      user: "gaming_app",
      host: "127.0.0.1",
      port: "5432",
      database: "dev",
    });
    expect(options.prepare).toBe(false);
    expect(options.max).toBe(2);
    expect(options.ssl).toBeUndefined();
    const supabase = runtimePostgresClientOptions({
      user: `gaming_app.${REF}`,
      host: POOLER_HOST,
      port: "6543",
      database: "postgres",
    });
    expect(supabase.prepare).toBe(false);
    expect(supabase.ssl).toBe("require");
  });
});
