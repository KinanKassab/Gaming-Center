/** Reset and seed ONLY the explicitly approved local disposable PostgreSQL database. */
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAuth } from "../src/auth/auth";
import { authenticateRequest, resolveOrganizationContext } from "../src/auth/context";
import { createAuthAccountProvisioner } from "../src/auth/provisioning";
import { appSchema, assertRuntimeDatabaseRole } from "../src/db/client";
import { assertLocalBrowserFixtureTarget } from "../src/db/browser-fixture-guard";
import { assertConnectedDatabaseIsApprovedDisposable, RESET_PUBLIC_SCHEMA_SQL } from "../src/db/disposable-test-db";
import { applyAllSqlMigrations } from "../src/db/migrate";
import { createProduct } from "../src/modules/catalog";
import { createCustomer } from "../src/modules/customers";
import { createArea, createDevice, createDeviceType, createPricingAssignment, createPricingPlan } from "../src/modules/gaming";
import { assignRoleToMembership, createBranch, createOrganization, createRole, createUserWithMembership, grantBranchAccess, setRolePermissions } from "../src/modules/identity";
import { PERMISSIONS } from "../src/modules/identity/types";

loadEnvConfig(process.cwd());

export const BROWSER_FIXTURE = {
  ownerEmail: "browser-owner@example.test",
  foreignOwnerEmail: "browser-foreign-owner@example.test",
  staffEmail: "browser-staff@example.test",
  password: "Synthetic-only-browser-password-123",
} as const;

async function main() {
  const adminUrl = process.env.GAMING_TEST_DATABASE_URL?.trim() || process.env.MIGRATION_DATABASE_URL?.trim();
  const runtimeUrl = process.env.GAMING_TEST_RUNTIME_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  const optIn = process.env.GAMING_TEST_ALLOW_RESET;
  assertLocalBrowserFixtureTarget(adminUrl, optIn);
  assertLocalBrowserFixtureTarget(runtimeUrl, optIn);
  if (!adminUrl || !runtimeUrl) throw new Error("Disposable admin and runtime URLs are required");
  const adminIdentity = new URL(adminUrl);
  const runtimeIdentity = new URL(runtimeUrl);
  if (adminIdentity.hostname !== runtimeIdentity.hostname || adminIdentity.port !== runtimeIdentity.port) {
    throw new Error("REFUSED BROWSER FIXTURE RESET: admin and runtime connections differ");
  }
  if (runtimeIdentity.username !== "gaming_app") {
    throw new Error("REFUSED BROWSER FIXTURE RESET: runtime URL must use gaming_app");
  }

  const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => undefined });
  const runtime = postgres(runtimeUrl, { max: 2, prepare: false });
  try {
    const [adminDb] = await admin<{ name: string }[]>`SELECT current_database() AS name`;
    const [runtimeDb] = await runtime<{ name: string }[]>`SELECT current_database() AS name`;
    assertConnectedDatabaseIsApprovedDisposable(adminDb?.name ?? "");
    assertConnectedDatabaseIsApprovedDisposable(runtimeDb?.name ?? "");

    await admin.unsafe(RESET_PUBLIC_SCHEMA_SQL);
    await applyAllSqlMigrations((sql) => admin.unsafe(sql));
    const db = drizzle(runtime, { schema: appSchema });
    await assertRuntimeDatabaseRole(db);
    const auth = createAuth(db, {
      baseURL: "http://127.0.0.1:3000",
      secret: "synthetic-browser-fixture-secret-never-production-123",
    });
    const signup = await auth.api.signUpEmail({ body: {
      email: BROWSER_FIXTURE.ownerEmail,
      password: BROWSER_FIXTURE.password,
      name: "Browser Test Owner",
    } });
    const signin = await auth.api.signInEmail({ body: {
      email: BROWSER_FIXTURE.ownerEmail,
      password: BROWSER_FIXTURE.password,
    }, returnHeaders: true });
    const cookie = signin.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const headers = new Headers({ cookie });
    const core = await authenticateRequest(db, auth, headers);
    if (core.user.authSubject !== signup.user.id) throw new Error("Owner identity mismatch");
    const org = await createOrganization(db, { userId: core.user.id }, {
      slug: "browser-fixture",
      name: "Synthetic Gaming Center",
      defaultCurrency: "SYP",
      timezone: "Asia/Damascus",
      locale: "en",
    });
    const actor = async () => (await resolveOrganizationContext(db, core, org.organizationId)).actor;
    const mainBranch = await createBranch(db, await actor(), { name: "Test Main" });
    const otherBranch = await createBranch(db, await actor(), { name: "Test Restricted" });
    const type = await createDeviceType(db, await actor(), { name: "PC Station", category: "PC" });
    const area = await createArea(db, await actor(), { branchId: mainBranch.id, name: "Main Hall" });
    const otherArea = await createArea(db, await actor(), { branchId: otherBranch.id, name: "Restricted Hall" });
    const device = await createDevice(db, await actor(), {
      branchId: mainBranch.id, areaId: area.id, deviceTypeId: type.id, name: "Test PC 1",
    });
    const restrictedDevice = await createDevice(db, await actor(), {
      branchId: otherBranch.id, areaId: otherArea.id, deviceTypeId: type.id, name: "Restricted PC",
    });
    const plan = await createPricingPlan(db, await actor(), {
      name: "Test Hourly", pricingModel: "TIME_BASED", rateMinor: 6000,
      billingUnitSeconds: 60, roundingMode: "CEIL",
    });
    for (const branchDevice of [device, restrictedDevice]) {
      await createPricingAssignment(db, await actor(), {
        pricingPlanId: plan.id, scopeType: "DEVICE", branchId: branchDevice.branchId, scopeId: branchDevice.id,
      });
    }
    const customer = await createCustomer(db, await actor(), {
      displayName: "Synthetic Customer", createdBranchId: mainBranch.id,
    });
    const product = await createProduct(db, await actor(), {
      name: "Test Cola", productType: "NON_STOCK", trackInventory: false, amountMinor: "15000",
    });
    const staff = await createUserWithMembership(db, await actor(), {
      email: BROWSER_FIXTURE.staffEmail, password: BROWSER_FIXTURE.password, displayName: "Browser Test Staff",
    }, createAuthAccountProvisioner(auth));
    const role = await createRole(db, await actor(), { code: "BROWSER_STAFF", name: "Browser staff" });
    await setRolePermissions(db, await actor(), role.id, { permissionCodes: [
      PERMISSIONS.organizationsRead, PERMISSIONS.branchesRead, PERMISSIONS.customersRead, PERMISSIONS.gamingMasterRead,
      PERMISSIONS.gamingSessionsRead,
    ] });
    await assignRoleToMembership(db, await actor(), staff.membershipId, role.id);
    await grantBranchAccess(db, await actor(), staff.membershipId, mainBranch.id, { accessMode: "VIEW" });

    const foreignSignup = await auth.api.signUpEmail({ body: {
      email: BROWSER_FIXTURE.foreignOwnerEmail,
      password: BROWSER_FIXTURE.password,
      name: "Browser Foreign Owner",
    } });
    const foreignSignIn = await auth.api.signInEmail({ body: {
      email: BROWSER_FIXTURE.foreignOwnerEmail,
      password: BROWSER_FIXTURE.password,
    }, returnHeaders: true });
    const foreignHeaders = new Headers({
      cookie: foreignSignIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "),
    });
    const foreignCore = await authenticateRequest(db, auth, foreignHeaders);
    if (foreignCore.user.authSubject !== foreignSignup.user.id) throw new Error("Foreign owner identity mismatch");
    const foreignOrg = await createOrganization(db, { userId: foreignCore.user.id }, {
      slug: "browser-foreign-fixture", name: "Foreign Synthetic Center",
      defaultCurrency: "SYP", timezone: "Asia/Damascus", locale: "en",
    });
    const foreignActor = (await resolveOrganizationContext(db, foreignCore, foreignOrg.organizationId)).actor;
    const foreignBranch = await createBranch(db, foreignActor, { name: "Foreign Branch" });
    const foreignCustomer = await createCustomer(db, (await resolveOrganizationContext(db, foreignCore, foreignOrg.organizationId)).actor, {
      displayName: "Foreign Synthetic Customer", createdBranchId: foreignBranch.id,
    });

    const fixture = {
      ...BROWSER_FIXTURE,
      organizationId: org.organizationId,
      mainBranchId: mainBranch.id,
      restrictedBranchId: otherBranch.id,
      deviceId: device.id,
      restrictedDeviceId: restrictedDevice.id,
      customerId: customer.customer.id,
      productId: product.id,
      foreignOrganizationId: foreignOrg.organizationId,
      foreignBranchId: foreignBranch.id,
      foreignCustomerId: foreignCustomer.customer.id,
    };
    await writeFile(resolve(process.cwd(), ".tmp-browser-fixture.json"), JSON.stringify(fixture, null, 2));
    const counts = await admin<{ organizations: string; branches: string; devices: string; customers: string; products: string; users: string }[]>`
      SELECT (SELECT count(*) FROM core_organizations) AS organizations,
             (SELECT count(*) FROM core_branches) AS branches,
             (SELECT count(*) FROM gaming_devices) AS devices,
             (SELECT count(*) FROM core_customers) AS customers,
             (SELECT count(*) FROM catalog_products) AS products,
             (SELECT count(*) FROM auth_users) AS users`;
    console.log("Disposable browser fixture ready", counts[0]);
  } finally {
    await runtime.end();
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
