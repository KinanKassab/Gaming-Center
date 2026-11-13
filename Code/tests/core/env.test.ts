import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvironmentError,
  assertRuntimeEnvironment,
  originFromAppBaseUrl,
  parseDatabaseUrl,
  publicAppOrigin,
  redactDatabaseUrl,
  trustedAppOrigins,
} from "@/core/env";

describe("environment validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses database URLs without exposing the password", () => {
    const parsed = parseDatabaseUrl("postgres://gaming_app:s3cret@127.0.0.1:5432/gaming_center_dev");
    expect(parsed).toEqual({
      protocol: "postgres:",
      user: "gaming_app",
      host: "127.0.0.1",
      port: "5432",
      database: "gaming_center_dev",
    });
    expect(redactDatabaseUrl("postgres://gaming_app:s3cret@127.0.0.1:5432/gaming_center_dev")).toBe(
      "postgres://gaming_app:***@127.0.0.1:5432/gaming_center_dev",
    );
    expect(redactDatabaseUrl("postgres://gaming_app:s3cret@127.0.0.1:5432/gaming_center_dev")).not.toContain("s3cret");
  });

  it("rejects malformed database URLs", () => {
    expect(() => parseDatabaseUrl("not-a-url")).toThrow(EnvironmentError);
    expect(() => parseDatabaseUrl("postgres://gaming_app@127.0.0.1:5432/")).toThrow(EnvironmentError);
  });

  it("does not default APP_BASE_URL to localhost in production", () => {
    vi.stubEnv("APP_BASE_URL", "");
    expect(publicAppOrigin("test")).toBe("http://localhost:3000");
    expect(() => publicAppOrigin("production")).toThrow(/APP_BASE_URL/);
  });

  it("rejects http public hosts in production and allows localhost smoke", () => {
    expect(originFromAppBaseUrl("https://gc.example.com")).toBe("https://gc.example.com");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("DATABASE_URL", "postgres://gaming_app:p@127.0.0.1:5432/pilot");
    vi.stubEnv("MIGRATION_DATABASE_URL", "postgres://postgres:p@127.0.0.1:5432/pilot");
    vi.stubEnv("APP_BASE_URL", "http://gc.example.com");
    expect(() => assertRuntimeEnvironment({ nodeEnv: "production", nextPhase: "" })).toThrow(/https/);
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    expect(() => assertRuntimeEnvironment({ nodeEnv: "production", nextPhase: "" })).not.toThrow();
  });

  it("fails closed when production uses migration credentials as DATABASE_URL", () => {
    vi.stubEnv("APP_BASE_URL", "https://gc.example.com");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("DATABASE_URL", "postgres://postgres:p@127.0.0.1:5432/pilot");
    vi.stubEnv("MIGRATION_DATABASE_URL", "postgres://postgres:p@127.0.0.1:5432/pilot");
    expect(() => assertRuntimeEnvironment({ nodeEnv: "production", nextPhase: "" })).toThrow(
      /gaming_app|same as MIGRATION|privileged/i,
    );
  });

  it("accepts gaming_app.<project-ref> only on a Supabase pooler host", () => {
    vi.stubEnv("APP_BASE_URL", "https://gc.example.com");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://gaming_app.abcdefghijklmnopqr:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    );
    vi.stubEnv(
      "MIGRATION_DATABASE_URL",
      "postgres://postgres:p@db.abcdefghijklmnopqr.supabase.co:5432/postgres",
    );
    expect(() => assertRuntimeEnvironment({ nodeEnv: "production", nextPhase: "" })).not.toThrow();
    vi.stubEnv("DATABASE_URL", "postgres://gaming_app.abcdefghijklmnopqr:p@evil.example.com:6543/postgres");
    expect(() => assertRuntimeEnvironment({ nodeEnv: "production", nextPhase: "" })).toThrow(/pooler host/i);
  });

  it("requires Preview DB acknowledgement and transaction-pooler DATABASE_URL on Vercel", () => {
    const secret = "x".repeat(32);
    const runtime =
      "postgres://gaming_app.abcdefghijklmnopqr:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
    const migration = "postgres://postgres:p@db.abcdefghijklmnopqr.supabase.co:5432/postgres";
    expect(() =>
      assertRuntimeEnvironment({
        nodeEnv: "production",
        nextPhase: "",
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "preview",
          VERCEL_URL: "gc-git-main-akodus.vercel.app",
          BETTER_AUTH_SECRET: secret,
          DATABASE_URL: runtime,
          MIGRATION_DATABASE_URL: migration,
          GAMING_SUPABASE_PROJECT_REF: "abcdefghijklmnopqr",
        },
      }),
    ).toThrow(/GAMING_PREVIEW_DB_OK/);
    expect(() =>
      assertRuntimeEnvironment({
        nodeEnv: "production",
        nextPhase: "",
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "preview",
          VERCEL_URL: "gc-git-main-akodus.vercel.app",
          BETTER_AUTH_SECRET: secret,
          DATABASE_URL: runtime,
          MIGRATION_DATABASE_URL: migration,
          GAMING_SUPABASE_PROJECT_REF: "abcdefghijklmnopqr",
          GAMING_PREVIEW_DB_OK: "true",
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertRuntimeEnvironment({
        nodeEnv: "production",
        nextPhase: "",
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          APP_BASE_URL: "https://gc.example.com",
          BETTER_AUTH_SECRET: secret,
          DATABASE_URL: "postgres://gaming_app:p@127.0.0.1:5432/pilot",
          MIGRATION_DATABASE_URL: "postgres://postgres:p@127.0.0.1:5432/pilot",
        },
      }),
    ).toThrow(/transaction pooler/i);
  });

  it("skips production checks during next build", () => {
    expect(() => assertRuntimeEnvironment({ nodeEnv: "production", nextPhase: "phase-production-build" })).not.toThrow();
  });

  it("derives Vercel Preview origins only from Vercel-provided hosts", () => {
    expect(
      trustedAppOrigins("production", {
        VERCEL_ENV: "preview",
        VERCEL_URL: "gc-git-main-akodus.vercel.app",
        VERCEL_BRANCH_URL: "gc-git-feat-akodus.vercel.app",
      }),
    ).toEqual([
      "https://gc-git-main-akodus.vercel.app",
      "https://gc-git-feat-akodus.vercel.app",
    ]);
    expect(
      trustedAppOrigins("production", {
        VERCEL_ENV: "preview",
        APP_BASE_URL: "https://preview.example.com",
        VERCEL_URL: "gc-git-main-akodus.vercel.app",
      }),
    ).toContain("https://preview.example.com");
    expect(() =>
      trustedAppOrigins("production", {
        VERCEL_ENV: "preview",
        VERCEL_URL: "evil.example.com",
      }),
    ).toThrow(/VERCEL_URL|APP_BASE_URL/);
  });

  it("does not require GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN for production startup", () => {
    vi.stubEnv("APP_BASE_URL", "https://gc.example.com");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("DATABASE_URL", "postgres://gaming_app:p@127.0.0.1:5432/pilot");
    vi.stubEnv("MIGRATION_DATABASE_URL", "postgres://postgres:p@127.0.0.1:5432/pilot");
    expect(() => assertRuntimeEnvironment({ nodeEnv: "production", nextPhase: "" })).not.toThrow();
  });

  it("BUG-037: local PostgreSQL production start ignores a leftover GAMING_SUPABASE_PROJECT_REF", () => {
    const secret = "x".repeat(32);
    expect(() =>
      assertRuntimeEnvironment({
        nodeEnv: "production",
        nextPhase: "",
        env: {
          NODE_ENV: "production",
          APP_BASE_URL: "http://localhost:3000",
          BETTER_AUTH_SECRET: secret,
          DATABASE_URL: "postgres://gaming_app:p@127.0.0.1:5432/gaming_center_security_test",
          GAMING_SUPABASE_PROJECT_REF: "abcdefghijklmnopqr",
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertRuntimeEnvironment({
        nodeEnv: "production",
        nextPhase: "",
        env: {
          NODE_ENV: "production",
          APP_BASE_URL: "http://localhost:3000",
          BETTER_AUTH_SECRET: secret,
          DATABASE_URL: "postgres://gaming_app:p@127.0.0.1:5432/gaming_center_security_test",
          GAMING_SUPABASE_PROJECT_REF: "not-a-valid-ref",
        },
      }),
    ).not.toThrow();
  });

  it("hosted Supabase production still requires the URL to match GAMING_SUPABASE_PROJECT_REF", () => {
    const secret = "x".repeat(32);
    const matching =
      "postgres://gaming_app.abcdefghijklmnopqr:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
    const otherProject =
      "postgres://gaming_app.zzzzzzzzzzzzzzzzzz:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
    const migration = "postgres://postgres:p@db.abcdefghijklmnopqr.supabase.co:5432/postgres";
    expect(() =>
      assertRuntimeEnvironment({
        nodeEnv: "production",
        nextPhase: "",
        env: {
          NODE_ENV: "production",
          APP_BASE_URL: "https://gc.example.com",
          BETTER_AUTH_SECRET: secret,
          DATABASE_URL: matching,
          MIGRATION_DATABASE_URL: migration,
          GAMING_SUPABASE_PROJECT_REF: "abcdefghijklmnopqr",
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertRuntimeEnvironment({
        nodeEnv: "production",
        nextPhase: "",
        env: {
          NODE_ENV: "production",
          APP_BASE_URL: "https://gc.example.com",
          BETTER_AUTH_SECRET: secret,
          DATABASE_URL: otherProject,
          MIGRATION_DATABASE_URL: migration,
          GAMING_SUPABASE_PROJECT_REF: "abcdefghijklmnopqr",
        },
      }),
    ).toThrow(/does not match GAMING_SUPABASE_PROJECT_REF/);
    expect(() =>
      assertRuntimeEnvironment({
        nodeEnv: "production",
        nextPhase: "",
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          APP_BASE_URL: "https://gc.example.com",
          BETTER_AUTH_SECRET: secret,
          DATABASE_URL: matching,
          MIGRATION_DATABASE_URL: migration,
        },
      }),
    ).toThrow(/GAMING_SUPABASE_PROJECT_REF is required on Vercel/);
  });

  it("fails closed when a configured bootstrap token is too short", () => {
    vi.stubEnv("GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN", "short");
    expect(() => assertRuntimeEnvironment({ nodeEnv: "test", nextPhase: "" })).toThrow(
      /GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN/,
    );
  });
});
