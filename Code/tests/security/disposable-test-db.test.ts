import { describe, expect, it } from "vitest";
import {
  APPROVED_DISPOSABLE_TEST_DATABASE,
  assertConnectedDatabaseIsApprovedDisposable,
  assertDisposableTestResetAllowed,
  databaseNameFromPostgresUrl,
  evaluateDisposableTestResetGuard,
} from "@/db/disposable-test-db";

describe("disposable PostgreSQL test-database reset guard", () => {
  it("parses the database name from a postgres URL", () => {
    expect(
      databaseNameFromPostgresUrl(
        "postgres://gaming_test_migrator:secret@127.0.0.1:5432/gaming_center_security_test",
      ),
    ).toBe(APPROVED_DISPOSABLE_TEST_DATABASE);
    expect(
      databaseNameFromPostgresUrl(
        "postgresql://u:p@localhost:5432/gaming_center_security_test?sslmode=disable",
      ),
    ).toBe(APPROVED_DISPOSABLE_TEST_DATABASE);
  });

  it("does not infer a database name from a URL without a path", () => {
    expect(databaseNameFromPostgresUrl("postgres://u:p@127.0.0.1:5432")).toBeNull();
    expect(databaseNameFromPostgresUrl("not-a-url")).toBeNull();
  });

  it("allows reset only for the approved disposable database with an explicit flag", () => {
    const decision = evaluateDisposableTestResetGuard({
      databaseUrl: `postgres://u:p@127.0.0.1:5432/${APPROVED_DISPOSABLE_TEST_DATABASE}`,
      allowReset: "true",
    });
    expect(decision).toEqual({ allowed: true, databaseName: APPROVED_DISPOSABLE_TEST_DATABASE });
    expect(
      assertDisposableTestResetAllowed({
        databaseUrl: `postgres://u:p@127.0.0.1:5432/${APPROVED_DISPOSABLE_TEST_DATABASE}`,
        allowReset: "true",
      }),
    ).toBe(APPROVED_DISPOSABLE_TEST_DATABASE);
  });

  it("fails closed when the opt-in reset flag is missing", () => {
    const decision = evaluateDisposableTestResetGuard({
      databaseUrl: `postgres://u:p@127.0.0.1:5432/${APPROVED_DISPOSABLE_TEST_DATABASE}`,
      allowReset: undefined,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toMatch(/GAMING_TEST_ALLOW_RESET=true/);
    }
  });

  it.each([
    ["postgres", "postgres://u:p@127.0.0.1:5432/postgres"],
    ["template0", "postgres://u:p@127.0.0.1:5432/template0"],
    ["template1", "postgres://u:p@127.0.0.1:5432/template1"],
    ["another Akodus database", "postgres://u:p@127.0.0.1:5432/gaming_center_dev"],
    ["lookalike name", "postgres://u:p@127.0.0.1:5432/gaming_center_security_test_copy"],
  ])("refuses destructive reset of %s without connecting", (_label, url) => {
    const decision = evaluateDisposableTestResetGuard({
      databaseUrl: url,
      allowReset: "true",
    });
    expect(decision.allowed).toBe(false);
    expect(() =>
      assertDisposableTestResetAllowed({ databaseUrl: url, allowReset: "true" }),
    ).toThrow(/REFUSED DESTRUCTIVE TEST RESET/);
  });

  it("refuses when current_database() does not match the approved disposable name", () => {
    expect(() => assertConnectedDatabaseIsApprovedDisposable("postgres")).toThrow(
      /REFUSED DESTRUCTIVE TEST RESET/,
    );
    expect(() => assertConnectedDatabaseIsApprovedDisposable("gaming_center_dev")).toThrow(
      /REFUSED DESTRUCTIVE TEST RESET/,
    );
    expect(() =>
      assertConnectedDatabaseIsApprovedDisposable(APPROVED_DISPOSABLE_TEST_DATABASE),
    ).not.toThrow();
  });
});
