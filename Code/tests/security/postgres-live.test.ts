import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyAllSqlMigrations } from "@/db/migrate";
import { appSchema, assertRuntimeDatabaseRole } from "@/db/client";
import { dumpDatabase, restoreDatabase } from "@/ops/pg-backup";
import { createAuth } from "@/auth/auth";
import { createId } from "@/core/ids";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { endSession, finalizeSessionBilling, getSessionBilling, startSession } from "@/modules/gaming";
import { recordSessionPayment } from "@/modules/finance";
import {
  assignRoleToMembership,
  createUserWithMembership,
  setMembershipStatus,
} from "@/modules/identity";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import { authenticateRequest, resolveOrganizationContext } from "@/auth/context";
import {
  PIN_RUNTIME_ROLE_SQL,
  mapPgRoleRow,
  pinOrAssertRuntimeRole,
} from "@/db/runtime-role";
import {
  APPROVED_DISPOSABLE_TEST_DATABASE,
  FORCE_ROW_SECURITY_ON_RLS_TABLES_SQL,
  RESET_PUBLIC_SCHEMA_SQL,
  SUSPEND_FORCE_ROW_SECURITY_SQL,
  assertConnectedDatabaseIsApprovedDisposable,
  assertDisposableTestResetAllowed,
  evaluateDisposableTestResetGuard,
} from "@/db/disposable-test-db";

/**
 * Real PostgreSQL security verification (not PGlite).
 *
 * Required environment:
 *   GAMING_TEST_DATABASE_URL     privileged URL for the disposable database
 *   GAMING_TEST_ALLOW_RESET=true  opt-in before any schema wipe
 *
 * Optional:
 *   GAMING_TEST_RUNTIME_DATABASE_URL  connection as gaming_app
 *
 * Destructive cleanup runs only when the URL database name AND
 * current_database() are exactly `gaming_center_security_test`.
 * postgres / template0 / template1 / any other name fail closed.
 *
 * This file is excluded from `npm test`. Run:
 *   npm run test:postgres
 *
 * PostgreSQL 16+ is required. Do not install PostgreSQL automatically.
 */
const ADMIN_URL = process.env.GAMING_TEST_DATABASE_URL?.trim();
const ALLOW_RESET = process.env.GAMING_TEST_ALLOW_RESET?.trim();

type LiveSql = ReturnType<typeof postgres>;

/**
 * Transaction-local tenant GUC for live SQL. Same pattern as `withTenant`
 * (`set_config(..., is_local=true)` inside BEGIN). Not an RLS bypass.
 * This file uses postgres.js tagged SQL so constraint/RLS errors stay visible.
 */
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

describe("real PostgreSQL security verification", () => {
  it("requires GAMING_TEST_DATABASE_URL (fail closed; do not skip)", () => {
    if (!ADMIN_URL) {
      throw new Error(
        "BLOCKED BY ENVIRONMENT: GAMING_TEST_DATABASE_URL is not set. Real PostgreSQL 16+ verification was not run. See DEVELOPMENT_GUIDE.md. Do not treat PGlite results as PostgreSQL role/locking proof.",
      );
    }
  });

  it("refuses destructive reset of an unsafe or non-test database name without connecting", () => {
    const postgresDb = evaluateDisposableTestResetGuard({
      databaseUrl: "postgres://u:p@127.0.0.1:5432/postgres",
      allowReset: "true",
    });
    expect(postgresDb.allowed).toBe(false);

    const otherAkodus = evaluateDisposableTestResetGuard({
      databaseUrl: "postgres://u:p@127.0.0.1:5432/gaming_center_dev",
      allowReset: "true",
    });
    expect(otherAkodus.allowed).toBe(false);

    const missingFlag = evaluateDisposableTestResetGuard({
      databaseUrl: `postgres://u:p@127.0.0.1:5432/${APPROVED_DISPOSABLE_TEST_DATABASE}`,
      allowReset: undefined,
    });
    expect(missingFlag.allowed).toBe(false);
  });
});

describe.skipIf(!ADMIN_URL)("real PostgreSQL security verification — live", () => {
  it("applies migrations, pins gaming_app, and serializes last-admin overlap", async () => {
    if (!ADMIN_URL) {
      throw new Error("GAMING_TEST_DATABASE_URL is required");
    }

    const approvedName = assertDisposableTestResetAllowed({
      databaseUrl: ADMIN_URL,
      allowReset: ALLOW_RESET,
    });

    const admin = postgres(ADMIN_URL, { max: 4, onnotice: () => undefined });
    try {
      const connected = await admin<{ current_database: string }[]>`SELECT current_database()`;
      const currentDatabase = connected[0]?.current_database ?? "";
      assertConnectedDatabaseIsApprovedDisposable(currentDatabase);
      if (currentDatabase !== approvedName) {
        throw new Error(
          `REFUSED DESTRUCTIVE TEST RESET: URL database "${approvedName}" does not match current_database() "${currentDatabase}"`,
        );
      }

      await admin.unsafe(RESET_PUBLIC_SCHEMA_SQL);
      await applyAllSqlMigrations((text) => admin.unsafe(text));

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

      const bypass = await admin<{ n: string }[]>`
        SELECT proname AS n FROM pg_proc WHERE proname = 'app_bypass_rls'
      `;
      expect(bypass).toEqual([]);

      const runtimeUrl =
        process.env.GAMING_TEST_RUNTIME_DATABASE_URL?.trim() ??
        ADMIN_URL.replace(/\/\/([^:@/]+)(:[^@/]+)?@/, "//gaming_app@");

      let runtimeSql: ReturnType<typeof postgres> | undefined;
      try {
        runtimeSql = postgres(runtimeUrl, { max: 3, onnotice: () => undefined });
        const db = drizzle(runtimeSql, { schema: appSchema });
        await assertRuntimeDatabaseRole(db);

        const leakOrg = "00000000-0000-4000-8000-000000000001";
        await runtimeSql.begin(async (tx) => {
          await tx`SELECT set_config('app.organization_id', ${leakOrg}, true)`;
          await tx`SELECT set_config('app.user_id', '', true)`;
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

        const auth = createAuth(db, {
          baseURL: "http://localhost:3000",
          secret: "postgres-security-secret-never-production",
        });
        await auth.api.signUpEmail({
          body: { email: "pg-owner@example.com", password: "password-123", name: "Owner" },
        });
        const { headers } = await auth.api.signInEmail({
          body: { email: "pg-owner@example.com", password: "password-123" },
          returnHeaders: true,
        });
        const cookie = headers
          .getSetCookie()
          .map((value) => value.split(";")[0]!)
          .join("; ");
        const ownerHeaders = new Headers({ cookie });
        const ownerAuth = await authenticateRequest(db, auth, ownerHeaders);
        const { createOrganization } = await import("@/modules/identity");
        const created = await createOrganization(
          db,
          { userId: ownerAuth.user.id },
          {
            slug: `pg-${Date.now()}`,
            name: "PG Org",
            defaultCurrency: "SYP",
            timezone: "Asia/Damascus",
            locale: "ar",
          },
        );
        const ownerActor = (
          await resolveOrganizationContext(db, ownerAuth, created.organizationId)
        ).actor;

        const second = await createUserWithMembership(
          db,
          ownerActor,
          { email: "pg-admin2@example.com", password: "password-123", displayName: "Admin Two" },
          createAuthAccountProvisioner(auth),
        );
        await assignRoleToMembership(db, ownerActor, second.membershipId, created.ownerRoleId);
        const { headers: secondHeaderList } = await auth.api.signInEmail({
          body: { email: "pg-admin2@example.com", password: "password-123" },
          returnHeaders: true,
        });
        const secondHeaders = new Headers({
          cookie: secondHeaderList
            .getSetCookie()
            .map((value) => value.split(";")[0]!)
            .join("; "),
        });
        const secondAuth = await authenticateRequest(db, auth, secondHeaders);
        const secondActor = (
          await resolveOrganizationContext(db, secondAuth, created.organizationId)
        ).actor;

        const db2 = drizzle(postgres(runtimeUrl, { max: 1 }), { schema: appSchema });
        const results = await Promise.allSettled([
          setMembershipStatus(db, ownerActor, second.membershipId, "suspend"),
          setMembershipStatus(db2, secondActor, created.membershipId, "suspend"),
        ]);
        const succeeded = results.filter((result) => result.status === "fulfilled");
        expect(succeeded.length).toBeLessThan(2);
      } catch (error) {
        if (String(error).includes("password authentication failed") || String(error).includes("role \"gaming_app\" does not exist")) {
          throw new Error(
            `Runtime connection as gaming_app failed (${String(error)}). Create LOGIN role gaming_app with a password and set GAMING_TEST_RUNTIME_DATABASE_URL.`,
          );
        }
        throw error;
      } finally {
        await runtimeSql?.end({ timeout: 1 });
      }
    } finally {
      await admin.end({ timeout: 1 });
    }
  });

  it("enforces gaming master-data tenant FKs, RLS, and immutable ownership", async () => {
    if (!ADMIN_URL) {
      throw new Error("GAMING_TEST_DATABASE_URL is required");
    }

    const approvedName = assertDisposableTestResetAllowed({
      databaseUrl: ADMIN_URL,
      allowReset: ALLOW_RESET,
    });

    const admin = postgres(ADMIN_URL, { max: 4, onnotice: () => undefined });
    try {
      const connected = await admin<{ current_database: string }[]>`SELECT current_database()`;
      const currentDatabase = connected[0]?.current_database ?? "";
      assertConnectedDatabaseIsApprovedDisposable(currentDatabase);
      if (currentDatabase !== approvedName) {
        throw new Error(
          `REFUSED DESTRUCTIVE TEST RESET: URL database "${approvedName}" does not match current_database() "${currentDatabase}"`,
        );
      }

      await admin.unsafe(RESET_PUBLIC_SCHEMA_SQL);
      await applyAllSqlMigrations((text) => admin.unsafe(text));

      const fixtureRoleRows = await admin<
        {
          current_user: string;
          rolname: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolinherit: boolean;
          rolcanlogin: boolean;
        }[]
      >`
        SELECT current_user,
               r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolinherit, r.rolcanlogin
        FROM pg_roles r
        WHERE r.rolname = current_user
      `;
      const fixtureRole = fixtureRoleRows[0];
      if (!fixtureRole) {
        throw new Error("Fixture connection has no pg_roles row for current_user");
      }
      const fixtureAttributes = mapPgRoleRow(fixtureRole);
      expect(fixtureAttributes.isSuperuser).toBe(false);
      expect(fixtureAttributes.hasBypassRls).toBe(false);

      const namedRoles = await admin<
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
        WHERE rolname IN ('gaming_test_migrator', 'gaming_app')
      `;
      const migrator = namedRoles.find((row) => row.rolname === "gaming_test_migrator");
      if (!migrator) {
        throw new Error("gaming_test_migrator role is missing");
      }
      expect(mapPgRoleRow(migrator).isSuperuser).toBe(false);
      expect(mapPgRoleRow(migrator).hasBypassRls).toBe(false);
      const runtimeCatalog = namedRoles.find((row) => row.rolname === "gaming_app");
      if (!runtimeCatalog) {
        throw new Error("gaming_app role is missing after migrations");
      }
      expect(mapPgRoleRow(runtimeCatalog).isSuperuser).toBe(false);
      expect(mapPgRoleRow(runtimeCatalog).hasBypassRls).toBe(false);

      const rls = await admin<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
            'core_organizations',
            'gaming_areas',
            'gaming_device_types',
            'gaming_devices',
            'gaming_pricing_plans',
            'gaming_pricing_assignments'
          )
      `;
      expect(rls).toHaveLength(6);
      expect(rls.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

      const orgA = createId();
      const orgB = createId();
      const branchA1 = createId();
      const branchA2 = createId();
      const branchB1 = createId();
      const typeA = createId();
      const typeB = createId();
      const areaA1 = createId();
      const areaA2 = createId();
      const areaB1 = createId();
      const deviceA1 = createId();
      const deviceA2 = createId();
      const deviceB = createId();
      const planA = createId();
      const planB = createId();
      const assignmentA1 = createId();
      const assignmentB = createId();

      // Bootstrap: INSERT policy is id = app_current_organization_id().
      await withTenantSql(admin, orgA, async (tx) => {
        await tx`
          INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
          VALUES (${orgA}, 'pg-a', 'Org A', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')
        `;
        await tx`
          INSERT INTO core_branches (id, organization_id, code, name, status)
          VALUES
            (${branchA1}, ${orgA}, 'A1', 'Branch A1', 'ACTIVE'),
            (${branchA2}, ${orgA}, 'A2', 'Branch A2', 'ACTIVE')
        `;
        await tx`
          INSERT INTO gaming_device_types (id, organization_id, code, name, status)
          VALUES (${typeA}, ${orgA}, 'PC', 'PC', 'ACTIVE')
        `;
        await tx`
          INSERT INTO gaming_areas (id, organization_id, branch_id, code, name, status)
          VALUES
            (${areaA1}, ${orgA}, ${branchA1}, 'MAIN', 'Main A1', 'ACTIVE'),
            (${areaA2}, ${orgA}, ${branchA2}, 'HALL', 'Hall A2', 'ACTIVE')
        `;
        await tx`
          INSERT INTO gaming_devices
            (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
          VALUES
            (${deviceA1}, ${orgA}, ${branchA1}, ${areaA1}, ${typeA}, 'PC01', 'A1-PC', 'ENABLED'),
            (${deviceA2}, ${orgA}, ${branchA2}, ${areaA2}, ${typeA}, 'PC01', 'A2-PC', 'ENABLED')
        `;
        await tx`
          INSERT INTO gaming_pricing_plans (
            id, organization_id, code, name, pricing_model, currency,
            rate_minor, billing_unit_seconds, rounding_mode, status
          ) VALUES (
            ${planA}, ${orgA}, 'STD', 'Standard A', 'TIME_BASED', 'SYP',
            100, 60, 'CEIL', 'ACTIVE'
          )
        `;
        await tx`
          INSERT INTO gaming_pricing_assignments (
            id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
          ) VALUES (
            ${assignmentA1}, ${orgA}, ${branchA1}, ${planA}, 'AREA', ${areaA1}, 'ACTIVE'
          )
        `;
      });

      await withTenantSql(admin, orgB, async (tx) => {
        await tx`
          INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
          VALUES (${orgB}, 'pg-b', 'Org B', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')
        `;
        await tx`
          INSERT INTO core_branches (id, organization_id, code, name, status)
          VALUES (${branchB1}, ${orgB}, 'B1', 'Branch B1', 'ACTIVE')
        `;
        await tx`
          INSERT INTO gaming_device_types (id, organization_id, code, name, status)
          VALUES (${typeB}, ${orgB}, 'CONS', 'Console', 'ACTIVE')
        `;
        await tx`
          INSERT INTO gaming_areas (id, organization_id, branch_id, code, name, status)
          VALUES (${areaB1}, ${orgB}, ${branchB1}, 'MAIN', 'Main B1', 'ACTIVE')
        `;
        await tx`
          INSERT INTO gaming_devices
            (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
          VALUES (${deviceB}, ${orgB}, ${branchB1}, ${areaB1}, ${typeB}, 'PC01', 'B-PC', 'ENABLED')
        `;
        await tx`
          INSERT INTO gaming_pricing_plans (
            id, organization_id, code, name, pricing_model, currency,
            rate_minor, billing_unit_seconds, rounding_mode, status
          ) VALUES (
            ${planB}, ${orgB}, 'STD', 'Standard B', 'TIME_BASED', 'SYP',
            200, 60, 'CEIL', 'ACTIVE'
          )
        `;
        await tx`
          INSERT INTO gaming_pricing_assignments (
            id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
          ) VALUES (
            ${assignmentB}, ${orgB}, ${branchB1}, ${planB}, 'AREA', ${areaB1}, 'ACTIVE'
          )
        `;
      });

      const runtimeUrl =
        process.env.GAMING_TEST_RUNTIME_DATABASE_URL?.trim() ??
        ADMIN_URL.replace(/\/\/([^:@/]+)(:[^@/]+)?@/, "//gaming_app@");
      const runtimeSql = postgres(runtimeUrl, { max: 1, onnotice: () => undefined });
      try {
        const runtimeWho = await runtimeSql<{ current_user: string }[]>`SELECT current_user`;
        expect(runtimeWho[0]?.current_user).toBe("gaming_app");

        const snapshotB = () =>
          withTenantSql(runtimeSql, orgB, async (tx) => {
            const devices = await tx<
              {
                id: string;
                organization_id: string;
                branch_id: string;
                name: string;
                operational_status: string;
                archived_at: Date | null;
              }[]
            >`
              SELECT id, organization_id, branch_id, name, operational_status, archived_at
              FROM gaming_devices WHERE id = ${deviceB}
            `;
            const types = await tx<{ id: string; code: string; name: string; status: string }[]>`
              SELECT id, code, name, status FROM gaming_device_types WHERE id = ${typeB}
            `;
            const areas = await tx<{ id: string; branch_id: string; code: string; name: string }[]>`
              SELECT id, branch_id, code, name FROM gaming_areas WHERE id = ${areaB1}
            `;
            const plans = await tx<{ id: string; code: string; name: string; status: string }[]>`
              SELECT id, code, name, status FROM gaming_pricing_plans WHERE id = ${planB}
            `;
            const assignments = await tx<
              { id: string; branch_id: string | null; scope_type: string; scope_id: string; status: string }[]
            >`
              SELECT id, branch_id, scope_type, scope_id, status
              FROM gaming_pricing_assignments WHERE id = ${assignmentB}
            `;
            return { devices, types, areas, plans, assignments };
          });

        const beforeB = await snapshotB();
        expect(beforeB.devices.map((row) => row.name)).toEqual(["B-PC"]);
        expect(beforeB.types.map((row) => row.code)).toEqual(["CONS"]);

        await withTenantSql(runtimeSql, orgA, async (tx) => {
          const devices = await tx<{ name: string }[]>`SELECT name FROM gaming_devices ORDER BY name`;
          expect(devices.map((row) => row.name)).toEqual(["A1-PC", "A2-PC"]);

          const hiddenB = await tx<{ id: string }[]>`SELECT id FROM gaming_devices WHERE id = ${deviceB}`;
          expect(hiddenB).toHaveLength(0);

          const types = await tx<{ code: string }[]>`SELECT code FROM gaming_device_types ORDER BY code`;
          expect(types.map((row) => row.code)).toEqual(["PC"]);

          const hiddenType = await tx<{ id: string }[]>`
            SELECT id FROM gaming_device_types WHERE id = ${typeB}
          `;
          expect(hiddenType).toHaveLength(0);
        });

        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_devices
              (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
            VALUES (${createId()}, ${orgA}, ${branchA1}, ${areaA2}, ${typeA}, 'PC99', 'Cross-branch', 'ENABLED')
          `),
        ).rejects.toThrow();

        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE gaming_areas SET branch_id = ${branchA2} WHERE id = ${areaA1}
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE gaming_devices SET branch_id = ${branchA2} WHERE id = ${deviceA1}
          `),
        ).rejects.toThrow();

        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_devices
              (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
            VALUES (${createId()}, ${orgA}, ${branchA1}, ${areaB1}, ${typeA}, 'PC98', 'Cross-tenant-area', 'ENABLED')
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_devices
              (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
            VALUES (${createId()}, ${orgA}, ${branchA1}, ${areaA1}, ${typeB}, 'PC96', 'Cross-type', 'ENABLED')
          `),
        ).rejects.toThrow();

        const updateB = await withTenantSql(runtimeSql, orgA, (tx) => tx<{ id: string }[]>`
          UPDATE gaming_devices SET name = 'hijacked' WHERE id = ${deviceB} RETURNING id
        `);
        expect(updateB).toHaveLength(0);
        const archiveB = await withTenantSql(runtimeSql, orgA, (tx) => tx<{ id: string }[]>`
          UPDATE gaming_devices SET archived_at = now() WHERE id = ${deviceB} RETURNING id
        `);
        expect(archiveB).toHaveLength(0);
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            DELETE FROM gaming_devices WHERE id = ${deviceA1}
          `),
        ).rejects.toThrow(/permission denied/);
        const rejectTypeB = await withTenantSql(runtimeSql, orgA, (tx) => tx<{ id: string }[]>`
          UPDATE gaming_device_types SET name = 'stolen' WHERE id = ${typeB} RETURNING id
        `);
        expect(rejectTypeB).toHaveLength(0);

        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_pricing_assignments (
              id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
            ) VALUES (${createId()}, ${orgA}, ${branchB1}, ${planA}, 'BRANCH', ${branchB1}, 'ACTIVE')
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_pricing_assignments (
              id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
            ) VALUES (${createId()}, ${orgA}, ${branchA1}, ${planA}, 'AREA', ${areaB1}, 'ACTIVE')
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_pricing_assignments (
              id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
            ) VALUES (${createId()}, ${orgA}, ${branchA1}, ${planA}, 'DEVICE', ${deviceB}, 'ACTIVE')
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_pricing_assignments (
              id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
            ) VALUES (${createId()}, ${orgA}, ${branchA1}, ${planA}, 'AREA', ${areaA2}, 'ACTIVE')
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_pricing_assignments (
              id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
            ) VALUES (${createId()}, ${orgA}, ${branchA1}, ${planA}, 'DEVICE', ${deviceA2}, 'ACTIVE')
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_pricing_assignments (
              id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
            ) VALUES (${createId()}, ${orgA}, ${branchA1}, ${planA}, 'ORGANIZATION', ${orgA}, 'ACTIVE')
          `),
        ).rejects.toThrow();

        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO gaming_devices
              (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
            VALUES (${createId()}, ${orgA}, ${branchA1}, ${areaA1}, ${typeA}, 'PC97', 'Bad status', 'OCCUPIED')
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE gaming_devices SET organization_id = ${orgB} WHERE id = ${deviceA1}
          `),
        ).rejects.toThrow();
        await expect(
          withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE gaming_devices SET branch_id = ${branchB1} WHERE id = ${deviceA1}
          `),
        ).rejects.toThrow();

        const afterB = await snapshotB();
        expect(afterB).toEqual(beforeB);

        const userA = createId();
        const userB = createId();
        await admin`
          INSERT INTO core_users (id, auth_subject, display_name, status)
          VALUES (${userA}, ${`live-${userA}`}, 'Operator A', 'ACTIVE'),
                 (${userB}, ${`live-${userB}`}, 'Operator B', 'ACTIVE')
        `;
        const actorFor = (userId: string, organizationId: string, branchId: string): OrganizationActor => ({
          userId,
          organizationId,
          membershipId: createId(),
          permissions: [
            PERMISSIONS.gamingSessionsRead,
            PERMISSIONS.gamingSessionsStart,
            PERMISSIONS.gamingSessionsOperate,
            PERMISSIONS.gamingSessionsCancel,
            PERMISSIONS.financePaymentsRead,
            PERMISSIONS.financePaymentsCreate,
          ],
          branchAccess: [{ branchId, accessMode: "OPERATE" }],
        });
        const sql1 = postgres(runtimeUrl, { max: 1, onnotice: () => undefined });
        const sql2 = postgres(runtimeUrl, { max: 1, onnotice: () => undefined });
        const db1 = drizzle(sql1, { schema: appSchema });
        const db2 = drizzle(sql2, { schema: appSchema });
        const actorA1 = actorFor(userA, orgA, branchA1);
        const actorA2 = actorFor(userB, orgA, branchA1);
        try {
          // Regression: postgres.js must bind Date instants through Drizzle helpers.
          // A sequential start with a NULL valid_to window must insert a session.
          const openWindow = await startSession(db1, actorA1, { deviceId: deviceA1 });
          expect(openWindow.status).toBe("ACTIVE");
          expect(openWindow.currentDeviceId).toBe(deviceA1);
          await endSession(db1, actorA1, openWindow.id);

          await withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE gaming_pricing_assignments
            SET valid_to = now() + interval '1 day'
            WHERE id = ${assignmentA1}
          `);
          const boundedWindow = await startSession(db1, actorA1, { deviceId: deviceA1 });
          expect(boundedWindow.status).toBe("ACTIVE");
          await endSession(db1, actorA1, boundedWindow.id);

          const races = await Promise.allSettled([
            startSession(db1, actorA1, { deviceId: deviceA1 }),
            startSession(db2, actorA2, { deviceId: deviceA1 }),
          ]);
          const ok = races.filter((row) => row.status === "fulfilled");
          const failed = races.filter((row) => row.status === "rejected");
          expect(ok).toHaveLength(1);
          expect(failed).toHaveLength(1);
          const winner = (ok[0] as PromiseFulfilledResult<{ id: string; currentDeviceId: string | null }>).value;
          expect(winner.currentDeviceId).toBe(deviceA1);

          const counted = await withTenantSql(runtimeSql, orgA, async (tx) => {
            return tx<{ n: string }[]>`
              SELECT count(*)::text AS n FROM gaming_sessions
              WHERE current_device_id = ${deviceA1} AND status IN ('ACTIVE', 'PAUSED')
            `;
          });
          expect(counted[0]?.n).toBe("1");

          await expect(endSession(db1, actorFor(userA, orgB, branchB1), winner.id)).rejects.toThrow();
          await expect(
            startSession(db1, actorFor(userA, orgA, branchA2), { deviceId: deviceA1 }),
          ).rejects.toThrow();

          await withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE gaming_devices SET operational_status = 'MAINTENANCE' WHERE id = ${deviceA2}
          `);
          await expect(startSession(db1, actorA1, { deviceId: deviceA2 })).rejects.toThrow();
          await withTenantSql(runtimeSql, orgA, (tx) => tx`
            UPDATE gaming_devices SET operational_status = 'ENABLED' WHERE id = ${deviceA2}
          `);

          await expect(
            withTenantSql(runtimeSql, orgA, (tx) => tx`
              UPDATE gaming_sessions SET organization_id = ${orgB} WHERE id = ${winner.id}
            `),
          ).rejects.toThrow();
          await expect(
            withTenantSql(runtimeSql, orgA, (tx) => tx`
              UPDATE gaming_sessions SET branch_id = ${branchA2} WHERE id = ${winner.id}
            `),
          ).rejects.toThrow();

          await endSession(db1, actorA1, winner.id);
          await expect(endSession(db1, actorA1, winner.id)).rejects.toThrow();

          const billSession = createId();
          const billSegment = createId();
          const billSnap = {
            assignmentId: assignmentA1,
            pricingPlanId: planA,
            code: "STD",
            name: "Standard A",
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
                ${billSession}, ${orgA}, ${branchA1}, '8001', 'OPEN', 'COMPLETED',
                NULL, now() - interval '90 seconds', now(), ${userA}, ${userA}
              )
            `;
            await tx`
              INSERT INTO gaming_session_segments (
                id, organization_id, branch_id, session_id, device_id, pricing_plan_id,
                started_at, ended_at, end_reason, pricing_snapshot
              ) VALUES (
                ${billSegment}, ${orgA}, ${branchA1}, ${billSession}, ${deviceA1}, ${planA},
                now() - interval '90 seconds', now(), 'SESSION_END', ${JSON.stringify(billSnap)}::jsonb
              )
            `;
          });

          const billRaces = await Promise.allSettled([
            finalizeSessionBilling(db1, actorA1, billSession),
            finalizeSessionBilling(db2, actorA2, billSession),
          ]);
          const billOk = billRaces.filter((row) => row.status === "fulfilled");
          expect(billOk.length).toBeGreaterThanOrEqual(1);
          const totals = billOk.map(
            (row) => (row as PromiseFulfilledResult<{ result: { totalMinor: string } | null }>).value.result?.totalMinor,
          );
          expect(new Set(totals)).toEqual(new Set(["200"]));
          const stored = await withTenantSql(runtimeSql, orgA, (tx) => tx<{ n: string; total: string | null }[]>`
            SELECT count(*)::text AS n, min(gaming_total_minor)::text AS total
            FROM gaming_sessions
            WHERE id = ${billSession} AND billing_finalized_at IS NOT NULL
          `);
          expect(stored[0]?.n).toBe("1");
          expect(stored[0]?.total).toBe("200");

          await expect(getSessionBilling(db1, actorFor(userA, orgB, branchB1), billSession)).rejects.toThrow();
          await expect(finalizeSessionBilling(db1, actorFor(userA, orgB, branchB1), billSession)).rejects.toThrow();
          await expect(
            withTenantSql(runtimeSql, orgA, (tx) => tx`
              UPDATE gaming_sessions SET gaming_total_minor = 1 WHERE id = ${billSession}
            `),
          ).rejects.toThrow();

          const paymentRaces = await Promise.allSettled([
            recordSessionPayment(
              db1,
              actorA1,
              billSession,
              { amountMinor: "200", paymentMethodCode: "CASH" },
              "live-pay-a",
            ),
            recordSessionPayment(
              db2,
              actorA2,
              billSession,
              { amountMinor: "200", paymentMethodCode: "CASH" },
              "live-pay-b",
            ),
          ]);
          const paymentOk = paymentRaces.filter((row) => row.status === "fulfilled");
          const paymentFailed = paymentRaces.filter((row) => row.status === "rejected");
          expect(paymentOk).toHaveLength(1);
          expect(paymentFailed).toHaveLength(1);
          const applied = await withTenantSql(runtimeSql, orgA, (tx) => tx<{ n: string; total: string }[]>`
            SELECT count(*)::text AS n, coalesce(sum(p.amount_minor), 0)::text AS total
            FROM finance_payments p
            JOIN finance_payment_allocations a ON a.payment_id = p.id
            JOIN finance_charges c ON c.id = a.charge_id
            WHERE c.source_id = ${billSession}
          `);
          expect(applied[0]?.n).toBe("1");
          expect(applied[0]?.total).toBe("200");

          const winnerPayment = (paymentOk[0] as PromiseFulfilledResult<{
            payment: { id: string };
            replayed: boolean;
          }>).value;
          const replay = await recordSessionPayment(
            db1,
            actorA1,
            billSession,
            { amountMinor: "200", paymentMethodCode: "CASH" },
            paymentRaces[0]?.status === "fulfilled" ? "live-pay-a" : "live-pay-b",
          );
          expect(replay.replayed).toBe(true);
          expect(replay.payment.id).toBe(winnerPayment.payment.id);

          await expect(
            recordSessionPayment(
              db1,
              actorFor(userA, orgB, branchB1),
              billSession,
              { amountMinor: "200", paymentMethodCode: "CASH" },
              "live-pay-tenant",
            ),
          ).rejects.toThrow();
          await expect(
            recordSessionPayment(
              db1,
              actorFor(userA, orgA, branchA2),
              billSession,
              { amountMinor: "200", paymentMethodCode: "CASH" },
              "live-pay-branch",
            ),
          ).rejects.toThrow();

          const billAfterPay = await withTenantSql(runtimeSql, orgA, (tx) => tx<{ total: string }[]>`
            SELECT gaming_total_minor::text AS total FROM gaming_sessions WHERE id = ${billSession}
          `);
          expect(billAfterPay[0]?.total).toBe("200");

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
              DELETE FROM gaming_sessions WHERE id = ${billSession}
            `),
          ).rejects.toThrow();

          const deletePriv = await runtimeSql<{
            sessions: boolean;
            payments: boolean;
            charges: boolean;
            audit: boolean;
            auditUpdate: boolean;
            customers: boolean;
            devices: boolean;
            settings: boolean;
          }[]>`
            SELECT
              has_table_privilege('gaming_app', 'gaming_sessions', 'DELETE') AS sessions,
              has_table_privilege('gaming_app', 'finance_payments', 'DELETE') AS payments,
              has_table_privilege('gaming_app', 'finance_charges', 'DELETE') AS charges,
              has_table_privilege('gaming_app', 'core_audit_logs', 'DELETE') AS audit,
              has_table_privilege('gaming_app', 'core_audit_logs', 'UPDATE') AS "auditUpdate",
              has_table_privilege('gaming_app', 'core_customers', 'DELETE') AS customers,
              has_table_privilege('gaming_app', 'gaming_devices', 'DELETE') AS devices,
              has_table_privilege('gaming_app', 'core_setting_values', 'DELETE') AS settings
          `;
          expect(deletePriv[0]?.sessions).toBe(false);
          expect(deletePriv[0]?.payments).toBe(false);
          expect(deletePriv[0]?.charges).toBe(false);
          expect(deletePriv[0]?.audit).toBe(false);
          expect(deletePriv[0]?.auditUpdate).toBe(false);
          expect(deletePriv[0]?.customers).toBe(false);
          expect(deletePriv[0]?.devices).toBe(false);
          expect(deletePriv[0]?.settings).toBe(true);

          const hiddenPay = await withTenantSql(runtimeSql, orgB, (tx) => tx<{ id: string }[]>`
            SELECT id FROM finance_payments WHERE id = ${winnerPayment.payment.id}
          `);
          expect(hiddenPay).toHaveLength(0);

          const restoreCustomerId = createId();
          await withTenantSql(runtimeSql, orgA, (tx) => tx`
            INSERT INTO core_customers (
              id, organization_id, display_name, status, portal_token, created_branch_id, created_by
            ) VALUES (
              ${restoreCustomerId}, ${orgA}, 'Restore drill customer', 'ACTIVE', gen_random_uuid(), ${branchA1}, ${userA}
            )
          `);

          const financialBefore = await withTenantSql(admin, orgA, (tx) => tx<{
            total: string;
            breakdown: string | null;
            payment: string;
            allocation: string;
            charge: string;
          }[]>`
            SELECT
              s.gaming_total_minor::text AS total,
              s.billing_breakdown::text AS breakdown,
              p.amount_minor::text AS payment,
              a.amount_minor::text AS allocation,
              c.total_minor::text AS charge
            FROM gaming_sessions s
            JOIN finance_charges c ON c.source_id = s.id
            JOIN finance_payments p ON p.id = ${winnerPayment.payment.id}
            JOIN finance_payment_allocations a ON a.payment_id = p.id
            WHERE s.id = ${billSession}
          `);
          expect(financialBefore[0]?.total).toBe("200");
          expect(financialBefore[0]?.payment).toBe("200");
          expect(financialBefore[0]?.allocation).toBe("200");
          expect(financialBefore[0]?.charge).toBe("200");
          expect(financialBefore[0]?.breakdown).toBeTruthy();

          const dumpDir = await mkdtemp(path.join(os.tmpdir(), "gc-restore-"));
          const dumpFile = path.join(dumpDir, "pilot.dump");
          try {
            await admin.unsafe(SUSPEND_FORCE_ROW_SECURITY_SQL);
            dumpDatabase(ADMIN_URL, dumpFile);
            await admin.unsafe(RESET_PUBLIC_SCHEMA_SQL);
            restoreDatabase(ADMIN_URL, dumpFile);
            await admin.unsafe(FORCE_ROW_SECURITY_ON_RLS_TABLES_SQL);
            const verify = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
            try {
              const restoredShape = await withTenantSql(verify, orgA, (tx) => tx<{
                organizations: string;
                branches: string;
                customers: string;
                sessions: string;
              }[]>`
                SELECT
                  (SELECT count(*)::text FROM core_organizations WHERE id = ${orgA}) AS organizations,
                  (SELECT count(*)::text FROM core_branches WHERE id = ${branchA1}) AS branches,
                  (SELECT count(*)::text FROM core_customers WHERE id = ${restoreCustomerId}) AS customers,
                  (SELECT count(*)::text FROM gaming_sessions WHERE id = ${billSession}) AS sessions
              `);
              expect(restoredShape[0]?.organizations).toBe("1");
              expect(restoredShape[0]?.branches).toBe("1");
              expect(restoredShape[0]?.customers).toBe("1");
              expect(restoredShape[0]?.sessions).toBe("1");

              const financialAfter = await withTenantSql(verify, orgA, (tx) => tx<{
                total: string;
                breakdown: string | null;
                payment: string;
                allocation: string;
                charge: string;
              }[]>`
                SELECT
                  s.gaming_total_minor::text AS total,
                  s.billing_breakdown::text AS breakdown,
                  p.amount_minor::text AS payment,
                  a.amount_minor::text AS allocation,
                  c.total_minor::text AS charge
                FROM gaming_sessions s
                JOIN finance_charges c ON c.source_id = s.id
                JOIN finance_payments p ON p.id = ${winnerPayment.payment.id}
                JOIN finance_payment_allocations a ON a.payment_id = p.id
                WHERE s.id = ${billSession}
              `);
              expect(financialAfter[0]?.total).toBe(financialBefore[0]?.total);
              expect(financialAfter[0]?.payment).toBe(financialBefore[0]?.payment);
              expect(financialAfter[0]?.allocation).toBe(financialBefore[0]?.allocation);
              expect(financialAfter[0]?.charge).toBe(financialBefore[0]?.charge);
              expect(financialAfter[0]?.breakdown).toBe(financialBefore[0]?.breakdown);
              const forceRls = await verify<{ relname: string; forced: boolean }[]>`
                SELECT c.relname, c.relforcerowsecurity AS forced
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relname IN ('gaming_sessions', 'finance_payments', 'core_customers', 'core_audit_logs')
              `;
              expect(forceRls).toHaveLength(4);
              expect(forceRls.every((row) => row.forced)).toBe(true);
            } finally {
              await verify.end({ timeout: 1 });
            }
          } finally {
            await rm(dumpDir, { recursive: true, force: true });
          }
        } finally {
          await sql1.end({ timeout: 1 });
          await sql2.end({ timeout: 1 });
        }
      } catch (error) {
        if (String(error).includes("password authentication failed") || String(error).includes("role \"gaming_app\" does not exist")) {
          throw new Error(
            `Runtime connection as gaming_app failed (${String(error)}). Create LOGIN role gaming_app with a password and set GAMING_TEST_RUNTIME_DATABASE_URL.`,
          );
        }
        throw error;
      } finally {
        await runtimeSql.end({ timeout: 1 });
      }
    } finally {
      await admin.end({ timeout: 1 });
    }
  });

  it("serializes concurrent first-user bootstrap claims on the platform singleton", async () => {
    if (!ADMIN_URL) {
      throw new Error("GAMING_TEST_DATABASE_URL is required");
    }

    const approvedName = assertDisposableTestResetAllowed({
      databaseUrl: ADMIN_URL,
      allowReset: ALLOW_RESET,
    });

    const admin = postgres(ADMIN_URL, { max: 4, onnotice: () => undefined });
    try {
      const connected = await admin<{ current_database: string }[]>`SELECT current_database()`;
      const currentDatabase = connected[0]?.current_database ?? "";
      assertConnectedDatabaseIsApprovedDisposable(currentDatabase);
      if (currentDatabase !== approvedName) {
        throw new Error(
          `REFUSED DESTRUCTIVE TEST RESET: URL database "${approvedName}" does not match current_database() "${currentDatabase}"`,
        );
      }

      await admin.unsafe(RESET_PUBLIC_SCHEMA_SQL);
      await applyAllSqlMigrations((text) => admin.unsafe(text));
      await pinOrAssertRuntimeRole({
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

      const runtimeUrl =
        process.env.GAMING_TEST_RUNTIME_DATABASE_URL?.trim() ??
        ADMIN_URL.replace(/\/\/([^:@/]+)(:[^@/]+)?@/, "//gaming_app@");

      const sql1 = postgres(runtimeUrl, { max: 1, onnotice: () => undefined });
      const sql2 = postgres(runtimeUrl, { max: 1, onnotice: () => undefined });
      try {
        const db1 = drizzle(sql1, { schema: appSchema });
        const db2 = drizzle(sql2, { schema: appSchema });
        await assertRuntimeDatabaseRole(db1);
        const { claimHttpSignupSlot } = await import("@/modules/identity");
        const results = await Promise.all([claimHttpSignupSlot(db1), claimHttpSignupSlot(db2)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        const rows = await sql1<{ n: string }[]>`SELECT count(*)::text AS n FROM core_users`;
        expect(rows[0]?.n).toBe("0");
      } finally {
        await sql1.end({ timeout: 1 });
        await sql2.end({ timeout: 1 });
      }
    } finally {
      await admin.end({ timeout: 1 });
    }
  });
});

