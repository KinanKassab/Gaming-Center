import { describe, expect, it } from "vitest";
import {
  evaluateSupabaseHostedTestGuard,
  assertSupabaseHostedTestAllowed,
} from "@/db/supabase-test-guard";

const REF = "abcdefghijklmnopqr";
const POOLER = "aws-0-eu-central-1.pooler.supabase.com";
const DIRECT = `db.${REF}.supabase.co`;

describe("hosted Supabase test guard", () => {
  it("allows a dedicated test project with matching refs, transaction-pooler runtime, and mutation flag", () => {
    const decision = evaluateSupabaseHostedTestGuard({
      migrationUrl: `postgres://postgres.${REF}:p@${POOLER}:5432/postgres`,
      runtimeUrl: `postgres://gaming_app.${REF}:p@${POOLER}:6543/postgres`,
      projectRef: REF,
      allowMutation: "true",
    });
    expect(decision.allowed).toBe(true);
  });

  it("allows direct migration URL on the same project", () => {
    const decision = evaluateSupabaseHostedTestGuard({
      migrationUrl: `postgres://postgres:p@${DIRECT}:5432/postgres`,
      runtimeUrl: `postgres://gaming_app.${REF}:p@${POOLER}:6543/postgres`,
      projectRef: REF,
      allowMutation: "true",
    });
    expect(decision.allowed).toBe(true);
  });

  it("fails closed without mutation flag, on local hosts, or when refs diverge", () => {
    expect(
      evaluateSupabaseHostedTestGuard({
        migrationUrl: `postgres://postgres.${REF}:p@${POOLER}:5432/postgres`,
        runtimeUrl: `postgres://gaming_app.${REF}:p@${POOLER}:6543/postgres`,
        projectRef: REF,
        allowMutation: undefined,
      }).allowed,
    ).toBe(false);

    expect(
      evaluateSupabaseHostedTestGuard({
        migrationUrl: "postgres://postgres:p@127.0.0.1:5432/postgres",
        runtimeUrl: `postgres://gaming_app.${REF}:p@${POOLER}:6543/postgres`,
        projectRef: REF,
        allowMutation: "true",
      }).allowed,
    ).toBe(false);

    expect(
      evaluateSupabaseHostedTestGuard({
        migrationUrl: `postgres://postgres.${REF}:p@${POOLER}:6543/postgres`,
        runtimeUrl: `postgres://gaming_app.${REF}:p@${POOLER}:6543/postgres`,
        projectRef: REF,
        allowMutation: "true",
      }).allowed,
    ).toBe(false);

    expect(
      evaluateSupabaseHostedTestGuard({
        migrationUrl: `postgres://postgres.${REF}:p@${POOLER}:5432/postgres`,
        runtimeUrl: `postgres://gaming_app.${REF}:p@${POOLER}:5432/postgres`,
        projectRef: REF,
        allowMutation: "true",
      }).allowed,
    ).toBe(false);

    const other = "zzzzzzzzzzzzzzzzzz";
    expect(
      evaluateSupabaseHostedTestGuard({
        migrationUrl: `postgres://postgres.${REF}:p@${POOLER}:5432/postgres`,
        runtimeUrl: `postgres://gaming_app.${other}:p@${POOLER}:6543/postgres`,
        projectRef: REF,
        allowMutation: "true",
      }).allowed,
    ).toBe(false);

    expect(() =>
      assertSupabaseHostedTestAllowed({
        migrationUrl: "postgres://u:p@127.0.0.1:5432/postgres",
        runtimeUrl: "postgres://u:p@127.0.0.1:5432/postgres",
        projectRef: REF,
        allowMutation: "true",
      }),
    ).toThrow(/REFUSED HOSTED SUPABASE TEST/);
  });
});
