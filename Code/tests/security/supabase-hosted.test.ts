import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { applyAllSqlMigrations } from "@/db/migrate";
import { appSchema, assertRuntimeDatabaseRole, createRuntimeSql } from "@/db/client";
import { parseDatabaseUrl } from "@/core/env";
import { migrationPostgresClientOptions } from "@/db/connection-mode";
import {
  PIN_RUNTIME_ROLE_SQL,
  mapPgRoleRow,
  pinOrAssertRuntimeRole,
} from "@/db/runtime-role";
import {
  RESET_PUBLIC_APPLICATION_OBJECTS_SQL,
  assertSupabaseHostedTestAllowed,
} from "@/db/supabase-test-guard";
import { createId } from "@/core/ids";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import {
  endSession,
  finalizeSessionBilling,
  moveSession,
  startSession,
  PACKAGE_MULTI_SEGMENT_MESSAGE,
} from "@/modules/gaming";
import { recordSessionPayment } from "@/modules/finance";
import { getPilotOperationsReport } from "@/modules/reports";

/**
 * Hosted Supabase compatibility (not the local disposable postgres suite).
 *
 * Required:
 *   GAMING_SUPABASE_TEST_DATABASE_URL          direct or session-pooler privileged URL
 *   GAMING_SUPABASE_TEST_RUNTIME_DATABASE_URL  transaction-pooler gaming_app.<ref>
 *   GAMING_SUPABASE_TEST_PROJECT_REF
 *   GAMING_SUPABASE_TEST_ALLOW_MUTATION=true
 *
 * Fail closed when unset. Never DROP DATABASE. Never wipe auth/storage schemas.
 */
const MIGRATION_URL = process.env.GAMING_SUPABASE_TEST_DATABASE_URL?.trim();
const RUNTIME_URL = process.env.GAMING_SUPABASE_TEST_RUNTIME_DATABASE_URL?.trim();
const PROJECT_REF = process.env.GAMING_SUPABASE_TEST_PROJECT_REF?.trim();
const ALLOW_MUTATION = process.env.GAMING_SUPABASE_TEST_ALLOW_MUTATION?.trim();

type LiveSql = ReturnType<typeof postgres>;

async function withTenantSql<T>(
  connection: LiveSql,
  organizationId: string,
  fn: (tx: LiveSql) => T | PromiseLike<T>,
): Promise<T> {
  const result = await connection.begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    await tx`SELECT set_config('app.user_id', '', true)`;
    return fn(tx as unknown as LiveSql);
  });
  return result as T;
}

describe("hosted Supabase compatibility", () => {
  it("requires explicit hosted test credentials (fail closed; do not skip)", () => {
    if (!MIGRATION_URL || !RUNTIME_URL || !PROJECT_REF) {
      throw new Error(
        "BLOCKED BY ENVIRONMENT: hosted Supabase tests require GAMING_SUPABASE_TEST_DATABASE_URL, GAMING_SUPABASE_TEST_RUNTIME_DATABASE_URL, and GAMING_SUPABASE_TEST_PROJECT_REF. Do not point npm run test:postgres at Supabase. See docs/operations/VERCEL_SUPABASE_DEPLOYMENT.md.",
      );
    }
    assertSupabaseHostedTestAllowed({
      migrationUrl: MIGRATION_URL,
      runtimeUrl: RUNTIME_URL,
      projectRef: PROJECT_REF,
      allowMutation: ALLOW_MUTATION,
    });
  });
});

describe.skipIf(!MIGRATION_URL || !RUNTIME_URL || !PROJECT_REF)(
  "hosted Supabase compatibility — live",
  () => {
    it("proves migrations, gaming_app, RLS, GUC, races, billing, payments, and Data API defense", async () => {
      assertSupabaseHostedTestAllowed({
        migrationUrl: MIGRATION_URL,
        runtimeUrl: RUNTIME_URL,
        projectRef: PROJECT_REF,
        allowMutation: ALLOW_MUTATION,
      });

      const admin = postgres(MIGRATION_URL!, migrationPostgresClientOptions(parseDatabaseUrl(MIGRATION_URL!)));
      const runtimeSql = createRuntimeSql(RUNTIME_URL!);
      const db = drizzle(runtimeSql, { schema: appSchema });
      const db2Sql = createRuntimeSql(RUNTIME_URL!);
      const db2 = drizzle(db2Sql, { schema: appSchema });

      try {
        await admin.unsafe(RESET_PUBLIC_APPLICATION_OBJECTS_SQL);
        const applied = await applyAllSqlMigrations((text) => admin.unsafe(text));
        expect(applied.some((name) => name.startsWith("0001"))).toBe(true);
        expect(applied.some((name) => name.startsWith("0010"))).toBe(true);
        expect(applied.some((name) => name.startsWith("0011"))).toBe(true);

        const pinned = await pinOrAssertRuntimeRole({
          tryAlter: async () => {
            await admin.unsafe(PIN_RUNTIME_ROLE_SQL);
          },
          readNamedRole: async () => {
            const rows = await admin<
              {
                rolname: string;
                rolsuper: boolean;
                rolbypassrls: boolean;
                rolcreatedb: boolean;
                rolcreaterole: boolean;
                rolinherit: boolean;
                rolcanlogin: boolean;
              }[]
            >`
              SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
              FROM pg_roles
              WHERE rolname = 'gaming_app'
            `;
            return rows[0] ? mapPgRoleRow(rows[0]) : undefined;
          },
        });
        expect(pinned.attributes.roleName).toBe("gaming_app");
        expect(pinned.attributes.isSuperuser).toBe(false);
        expect(pinned.attributes.hasBypassRls).toBe(false);
        expect(pinned.attributes.canCreateDb).toBe(false);
        expect(pinned.attributes.canCreateRole).toBe(false);
        expect(pinned.attributes.inherits).toBe(false);
        expect(pinned.attributes.canLogin).toBe(true);

        const who = await runtimeSql<{ current_user: string }[]>`SELECT current_user`;
        expect(who[0]?.current_user).toBe("gaming_app");
        await assertRuntimeDatabaseRole(db);

        const leakOrg = "00000000-0000-4000-8000-0000000000aa";
        await runtimeSql.begin(async (tx) => {
          await tx`SELECT set_config('app.organization_id', ${leakOrg}, true)`;
          const inside = await tx<{ v: string }[]>`SELECT current_setting('app.organization_id', true) AS v`;
          expect(inside[0]?.v).toBe(leakOrg);
        });
        const afterCommit = await runtimeSql<{ v: string }[]>`SELECT current_setting('app.organization_id', true) AS v`;
        expect(afterCommit[0]?.v ?? "").toBe("");
        await expect(
          runtimeSql.begin(async (tx) => {
            await tx`SELECT set_config('app.organization_id', ${leakOrg}, true)`;
            throw new Error("forced-rollback");
          }),
        ).rejects.toThrow(/forced-rollback/);
        const afterRollback = await runtimeSql<{ v: string }[]>`SELECT current_setting('app.organization_id', true) AS v`;
        expect(afterRollback[0]?.v ?? "").toBe("");

        const orgA = createId();
        const orgB = createId();
        const branchA = createId();
        const branchB = createId();
        const typeA = createId();
        const areaA = createId();
        const deviceA1 = createId();
        const deviceA2 = createId();
        const devicePkg = createId();
        const planTime = createId();
        const planPkg = createId();
        const assignTime = createId();
        const assignPkg = createId();
        const userA = createId();
        const userB = createId();

        await withTenantSql(admin, orgA, async (tx) => {
          await tx`
            INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
            VALUES (${orgA}, 'sb-a', 'Org A', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')
          `;
          await tx`
            INSERT INTO core_branches (id, organization_id, code, name, status)
            VALUES (${branchA}, ${orgA}, 'A1', 'Branch A1', 'ACTIVE')
          `;
          await tx`
            INSERT INTO core_users (id, auth_subject, display_name, status)
            VALUES (${userA}, ${`sb-${userA}`}, 'Operator A', 'ACTIVE'),
                   (${userB}, ${`sb-${userB}`}, 'Operator B', 'ACTIVE')
          `;
          await tx`
            INSERT INTO gaming_device_types (id, organization_id, code, name, status)
            VALUES (${typeA}, ${orgA}, 'PC', 'PC', 'ACTIVE')
          `;
          await tx`
            INSERT INTO gaming_areas (id, organization_id, branch_id, code, name, status)
            VALUES (${areaA}, ${orgA}, ${branchA}, 'MAIN', 'Main', 'ACTIVE')
          `;
          await tx`
            INSERT INTO gaming_devices
              (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
            VALUES
              (${deviceA1}, ${orgA}, ${branchA}, ${areaA}, ${typeA}, 'PC01', 'PC-1', 'ENABLED'),
              (${deviceA2}, ${orgA}, ${branchA}, ${areaA}, ${typeA}, 'PC02', 'PC-2', 'ENABLED'),
              (${devicePkg}, ${orgA}, ${branchA}, ${areaA}, ${typeA}, 'PKG1', 'PKG-1', 'ENABLED')
          `;
          await tx`
            INSERT INTO gaming_pricing_plans (
              id, organization_id, code, name, pricing_model, currency,
              rate_minor, billing_unit_seconds, rounding_mode, status
            ) VALUES (
              ${planTime}, ${orgA}, 'STD', 'Standard', 'TIME_BASED', 'SYP',
              100, 60, 'CEIL', 'ACTIVE'
            )
          `;
          await tx`
            INSERT INTO gaming_pricing_plans (
              id, organization_id, code, name, pricing_model, currency,
              package_duration_seconds, package_price_minor, rounding_mode, status
            ) VALUES (
              ${planPkg}, ${orgA}, 'PKG', 'Package', 'PACKAGE', 'SYP',
              3600, 5000, 'CEIL', 'ACTIVE'
            )
          `;
          await tx`
            INSERT INTO gaming_pricing_assignments (
              id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
            ) VALUES (
              ${assignTime}, ${orgA}, ${branchA}, ${planTime}, 'BRANCH', ${branchA}, 'ACTIVE'
            )
          `;
          await tx`
            INSERT INTO gaming_pricing_assignments (
              id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status, priority
            ) VALUES (
              ${assignPkg}, ${orgA}, ${branchA}, ${planPkg}, 'DEVICE', ${devicePkg}, 'ACTIVE', 10
            )
          `;
        });

        await withTenantSql(admin, orgB, async (tx) => {
          await tx`
            INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
            VALUES (${orgB}, 'sb-b', 'Org B', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')
          `;
          await tx`
            INSERT INTO core_branches (id, organization_id, code, name, status)
            VALUES (${branchB}, ${orgB}, 'B1', 'Branch B1', 'ACTIVE')
          `;
        });

        const hidden = await withTenantSql(runtimeSql, orgA, (tx) => tx<{ id: string }[]>`
          SELECT id FROM core_organizations WHERE id = ${orgB}
        `);
        expect(hidden).toHaveLength(0);

        const actorFor = (userId: string, organizationId: string, branchId: string): OrganizationActor => ({
          userId,
          organizationId,
          membershipId: createId(),
          permissions: [
            PERMISSIONS.gamingSessionsRead,
            PERMISSIONS.gamingSessionsStart,
            PERMISSIONS.gamingSessionsOperate,
            PERMISSIONS.financePaymentsRead,
            PERMISSIONS.financePaymentsCreate,
          ],
          branchAccess: [{ branchId, accessMode: "OPERATE" }],
        });
        const actorA = actorFor(userA, orgA, branchA);
        const actorA2 = actorFor(userB, orgA, branchA);

        const races = await Promise.allSettled([
          startSession(db, actorA, { deviceId: deviceA1 }),
          startSession(db2, actorA2, { deviceId: deviceA1 }),
        ]);
        const ok = races.filter((row) => row.status === "fulfilled");
        const failed = races.filter((row) => row.status === "rejected");
        expect(ok).toHaveLength(1);
        expect(failed).toHaveLength(1);
        const winner = (ok[0] as PromiseFulfilledResult<{ id: string }>).value;

        const moved = await moveSession(db, actorA, winner.id, { deviceId: deviceA2 });
        expect(moved.currentDeviceId).toBe(deviceA2);

        const pkg = await startSession(db, actorA, { deviceId: devicePkg });
        await expect(moveSession(db, actorA, pkg.id, { deviceId: deviceA1 })).rejects.toThrow(
          PACKAGE_MULTI_SEGMENT_MESSAGE,
        );
        await endSession(db, actorA, pkg.id);

        await endSession(db, actorA, winner.id);

        const billSession = createId();
        const billSegment = createId();
        const billSnap = {
          assignmentId: assignTime,
          pricingPlanId: planTime,
          code: "STD",
          name: "Standard",
          pricingModel: "TIME_BASED",
          currency: "SYP",
          rateMinor: "100",
          billingUnitSeconds: 60,
          roundingMode: "CEIL",
          minimumBillableSeconds: 0,
          minimumChargeMinor: "0",
          packageDurationSeconds: null,
          packagePriceMinor: null,
          capturedAt: new Date().toISOString(),
        };
        await withTenantSql(runtimeSql, orgA, async (tx) => {
          await tx`
            INSERT INTO gaming_sessions (
              id, organization_id, branch_id, session_number, session_type, status,
              current_device_id, started_at, ended_at, created_by, closed_by
            ) VALUES (
              ${billSession}, ${orgA}, ${branchA}, '8001', 'OPEN', 'COMPLETED',
              NULL, now() - interval '90 seconds', now(), ${userA}, ${userA}
            )
          `;
          await tx`
            INSERT INTO gaming_session_segments (
              id, organization_id, branch_id, session_id, device_id, pricing_plan_id,
              started_at, ended_at, end_reason, pricing_snapshot
            ) VALUES (
              ${billSegment}, ${orgA}, ${branchA}, ${billSession}, ${deviceA1}, ${planTime},
              now() - interval '90 seconds', now(), 'SESSION_END', ${JSON.stringify(billSnap)}::jsonb
            )
          `;
        });

        const billRaces = await Promise.allSettled([
          finalizeSessionBilling(db, actorA, billSession),
          finalizeSessionBilling(db2, actorA2, billSession),
        ]);
        const billOk = billRaces.filter((row) => row.status === "fulfilled");
        expect(billOk.length).toBeGreaterThanOrEqual(1);
        const stored = await withTenantSql(runtimeSql, orgA, (tx) => tx<{ n: string; total: string | null }[]>`
          SELECT count(*)::text AS n, min(gaming_total_minor)::text AS total
          FROM gaming_sessions
          WHERE id = ${billSession} AND billing_finalized_at IS NOT NULL
        `);
        expect(stored[0]?.n).toBe("1");
        expect(stored[0]?.total).toBe("200");

        const paymentRaces = await Promise.allSettled([
          recordSessionPayment(db, actorA, billSession, { amountMinor: "200", paymentMethodCode: "CASH" }, "sb-pay-a"),
          recordSessionPayment(db2, actorA2, billSession, { amountMinor: "200", paymentMethodCode: "CASH" }, "sb-pay-b"),
        ]);
        const paymentOk = paymentRaces.filter((row) => row.status === "fulfilled");
        expect(paymentOk).toHaveLength(1);
        const winnerPayment = (paymentOk[0] as PromiseFulfilledResult<{ payment: { id: string }; replayed: boolean }>)
          .value;
        const replayKey = paymentRaces[0]?.status === "fulfilled" ? "sb-pay-a" : "sb-pay-b";
        const replay = await recordSessionPayment(
          db,
          actorA,
          billSession,
          { amountMinor: "200", paymentMethodCode: "CASH" },
          replayKey,
        );
        expect(replay.replayed).toBe(true);
        expect(replay.payment.id).toBe(winnerPayment.payment.id);
        await expect(
          recordSessionPayment(
            db,
            actorA,
            billSession,
            { amountMinor: "1", paymentMethodCode: "CASH" },
            replayKey,
          ),
        ).rejects.toThrow();

        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE finance_payments SET amount_minor = 1 WHERE id = ${winnerPayment.payment.id}
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            DELETE FROM finance_payments WHERE id = ${winnerPayment.payment.id}
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE gaming_sessions SET gaming_total_minor = 1 WHERE id = ${billSession}
          `),
        ).rejects.toThrow();

        const otherOrgPay = await withTenantSql(runtimeSql, orgB, (tx) => tx<{ id: string }[]>`
          SELECT id FROM finance_payments WHERE id = ${winnerPayment.payment.id}
        `);
        expect(otherOrgPay).toHaveLength(0);

        const report = await getPilotOperationsReport(db, actorA, {
          branchId: branchA,
          from: new Date(Date.now() - 24 * 60 * 60 * 1000),
          to: new Date(Date.now() + 60 * 1000),
        });
        expect(report.sessionsByDay.length).toBeGreaterThanOrEqual(0);
        await expect(
          getPilotOperationsReport(db, actorFor(userA, orgB, branchB), {
            branchId: branchA,
            from: new Date(Date.now() - 24 * 60 * 60 * 1000),
            to: new Date(Date.now() + 60 * 1000),
          }),
        ).rejects.toThrow();

        const apiRoles = await admin<{ rolname: string }[]>`
          SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
        `;
        for (const role of apiRoles) {
          const priv = await admin<{ sel: boolean }[]>`
            SELECT has_table_privilege(${role.rolname}, 'core_organizations', 'SELECT') AS sel
          `;
          expect(priv[0]?.sel).toBe(false);
          const pay = await admin<{ sel: boolean }[]>`
            SELECT has_table_privilege(${role.rolname}, 'finance_payments', 'SELECT') AS sel
          `;
          expect(pay[0]?.sel).toBe(false);
        }
      } finally {
        await db2Sql.end({ timeout: 5 }).catch(() => undefined);
        await runtimeSql.end({ timeout: 5 }).catch(() => undefined);
        await admin.end({ timeout: 5 }).catch(() => undefined);
      }
    });
  },
);
