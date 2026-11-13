import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { coreUsers } from "@/db/schema";
import { GET as getAreas, POST as postAreas } from "@/app/api/gaming/areas/route";
import { GET as getArea } from "@/app/api/gaming/areas/[areaId]/route";
import { POST as postDevices } from "@/app/api/gaming/devices/route";
import { GET as getDevice } from "@/app/api/gaming/devices/[deviceId]/route";
import { GET as getDeviceTypes, POST as postDeviceTypes } from "@/app/api/gaming/device-types/route";
import { GET as getPlans, POST as postPlans } from "@/app/api/gaming/pricing-plans/route";
import { createBranch, PERMISSIONS } from "@/modules/identity";
import {
  createStaffMember,
  createTestEnvironment,
  invokeHttp,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
  signUp,
} from "../helpers/identity";
import { seedBranchAreaAndType } from "../helpers/gaming";

function jsonRequest(method: string, url: string, body?: unknown, extra?: Headers): Request {
  const headers = extra ? new Headers(extra) : new Headers();
  headers.set("content-type", "application/json");
  headers.set("origin", "http://localhost:3000");
  return new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

describe("gaming master-data HTTP authorization", () => {
  it("unauthenticated gaming routes return 401", async () => {
    const env = await createTestEnvironment();
    const areas = await invokeHttp(env, { headers: new Headers() }, () =>
      getAreas(new Request("http://localhost:3000/api/gaming/areas")),
    );
    expect((await readJson(areas)).status).toBe(401);
  });

  it("missing permission returns 403; owner can create master data", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m4-perm",
    });
    const plain = await createStaffMember(env, owner, {
      email: "plain@a.com",
      displayName: "Plain",
      roleCode: "NONE",
      permissions: [PERMISSIONS.branchesRead],
    });
    const forbidden = await invokeHttp(
      env,
      { headers: plain.headers, organizationId: owner.organizationId },
      () => getAreas(new Request("http://localhost:3000/api/gaming/areas")),
    );
    expect((await readJson(forbidden)).status).toBe(403);

    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, context.actor, { code: "JRM", name: "Jaramana" });
    const created = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postAreas(
          jsonRequest("POST", "http://localhost:3000/api/gaming/areas", {
            branchId: branch.id,
            code: "MAIN",
            name: "Main Hall",
          }),
        ),
    );
    const ok = await readJson(created);
    expect(ok.status).toBe(201);
    expect((ok.body.data as { code: string }).code).toBe("MAIN");
  });

  it("disabled Core User is rejected on gaming routes", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m4-disabled",
    });
    await env.db.update(coreUsers).set({ status: "DISABLED" }).where(eq(coreUsers.id, owner.userId));
    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => getDeviceTypes(new Request("http://localhost:3000/api/gaming/device-types")),
    );
    expect((await readJson(response)).status).toBe(403);
  });

  it("cross-tenant device UUID returns 404", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m4-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-m4-b",
    });
    const seededB = await seedBranchAreaAndType(env, ownerB, { branchCode: "B1" });
    const created = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () =>
        postDevices(
          jsonRequest("POST", "http://localhost:3000/api/gaming/devices", {
            branchId: seededB.branch.id,
            areaId: seededB.area.id,
            deviceTypeId: seededB.deviceType.id,
            code: "PC01",
            name: "PC 01",
          }),
        ),
    );
    const device = (await readJson(created)).body.data as { id: string };
    const leaked = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        getDevice(new Request(`http://localhost:3000/api/gaming/devices/${device.id}`), {
          params: Promise.resolve({ deviceId: device.id }),
        }),
    );
    expect((await readJson(leaked)).status).toBe(404);
  });

  it("rejects invalid input with 400 and serializes pricing minor units as strings", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m4-price",
    });
    const bad = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postPlans(
          jsonRequest("POST", "http://localhost:3000/api/gaming/pricing-plans", {
            code: "BAD",
            name: "Bad",
            pricingModel: "TIME_BASED",
            roundingMode: "CEIL",
          }),
        ),
    );
    expect((await readJson(bad)).status).toBe(400);

    const created = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postPlans(
          jsonRequest("POST", "http://localhost:3000/api/gaming/pricing-plans", {
            code: "STD",
            name: "Standard",
            pricingModel: "TIME_BASED",
            rateMinor: "1500",
            billingUnitSeconds: 60,
            roundingMode: "CEIL",
          }),
        ),
    );
    const ok = await readJson(created);
    expect(ok.status).toBe(201);
    expect((ok.body.data as { rateMinor: string }).rateMinor).toBe("1500");

    const listed = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => getPlans(new Request("http://localhost:3000/api/gaming/pricing-plans")),
    );
    expect((await readJson(listed)).status).toBe(200);
  });

  it("authenticated user without membership cannot create a device type", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m4-nomem",
    });
    await signUp(env.auth, { email: "stranger@x.com", password: "password-123", name: "Stranger" });
    const headers = await signInHeaders(env.auth, { email: "stranger@x.com", password: "password-123" });
    const response = await invokeHttp(env, { headers, organizationId: owner.organizationId }, () =>
      postDeviceTypes(jsonRequest("POST", "http://localhost:3000/api/gaming/device-types", { code: "PC", name: "PC" })),
    );
    expect((await readJson(response)).status).toBe(403);
  });

  it("returns 404 for a cross-tenant area UUID", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m4-area-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-m4-area-b",
    });
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);
    const branchB = await createBranch(env.db, contextB.actor, { code: "B1", name: "B" });
    const created = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () =>
        postAreas(
          jsonRequest("POST", "http://localhost:3000/api/gaming/areas", {
            branchId: branchB.id,
            code: "MAIN",
            name: "Main",
          }),
        ),
    );
    const area = (await readJson(created)).body.data as { id: string };
    const leaked = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        getArea(new Request(`http://localhost:3000/api/gaming/areas/${area.id}`), {
          params: Promise.resolve({ areaId: area.id }),
        }),
    );
    expect((await readJson(leaked)).status).toBe(404);
  });

  it("bulk device HTTP creates 10 devices and rejects missing permission", async () => {
    const { POST: postBulk } = await import("@/app/api/gaming/devices/bulk/route");
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-bulk",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const created = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postBulk(
          jsonRequest("POST", "http://localhost:3000/api/gaming/devices/bulk", {
            branchId: seeded.branch.id,
            areaId: seeded.area.id,
            deviceTypeId: seeded.deviceType.id,
            count: 10,
          }),
        ),
    );
    const payload = await readJson(created);
    expect(payload.status).toBe(201);
    expect((payload.body.data as unknown[]).length).toBe(10);

    const plain = await createStaffMember(env, owner, {
      email: "plain-bulk@a.com",
      displayName: "Plain",
      roleCode: "NONE2",
      permissions: [PERMISSIONS.branchesRead],
    });
    const forbidden = await invokeHttp(
      env,
      { headers: plain.headers, organizationId: owner.organizationId },
      () =>
        postBulk(
          jsonRequest("POST", "http://localhost:3000/api/gaming/devices/bulk", {
            branchId: seeded.branch.id,
            areaId: seeded.area.id,
            deviceTypeId: seeded.deviceType.id,
            count: 2,
          }),
        ),
    );
    expect((await readJson(forbidden)).status).toBe(403);
  });

  it("omitted codes are allocated and friendly pricing maps to TIME_BASED fields", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-auto-code",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, context.actor, { name: "Jaramana" });
    expect(branch.code.startsWith("B-")).toBe(true);

    const areaRes = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postAreas(
          jsonRequest("POST", "http://localhost:3000/api/gaming/areas", {
            branchId: branch.id,
            name: "Main Hall",
          }),
        ),
    );
    const area = await readJson(areaRes);
    expect(area.status).toBe(201);
    expect((area.body.data as { code: string }).code.startsWith("A-")).toBe(true);

    const typeRes = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postDeviceTypes(
          jsonRequest("POST", "http://localhost:3000/api/gaming/device-types", { name: "PlayStation 5" }),
        ),
    );
    const typeJson = await readJson(typeRes);
    expect(typeJson.status).toBe(201);
    expect((typeJson.body.data as { code: string }).code.startsWith("T-")).toBe(true);

    const planRes = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postPlans(
          jsonRequest("POST", "http://localhost:3000/api/gaming/pricing-plans", {
            name: "PlayStation 5",
            pricingModel: "TIME_BASED",
            priceMajor: "10,000",
            billingUnitSeconds: 3600,
            partialPeriod: "started",
          }),
        ),
    );
    const plan = await readJson(planRes);
    expect(plan.status).toBe(201);
    const planData = plan.body.data as {
      code: string;
      rateMinor: string;
      billingUnitSeconds: number;
      roundingMode: string;
    };
    expect(planData.code.startsWith("P-")).toBe(true);
    expect(planData.rateMinor).toBe("10000");
    expect(planData.billingUnitSeconds).toBe(3600);
    expect(planData.roundingMode).toBe("CEIL");
    expect((plan.body.data as { timeBillingMode: string }).timeBillingMode).toBe("UNIT");
  });

  it("defaults omitted TIME_BASED mode to PRORATED_HOUR", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-prorated",
    });
    const planRes = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postPlans(
          jsonRequest("POST", "http://localhost:3000/api/gaming/pricing-plans", {
            name: "PlayStation 5",
            pricingModel: "TIME_BASED",
            priceMajor: "10,000",
          }),
        ),
    );
    const plan = await readJson(planRes);
    expect(plan.status).toBe(201);
    const planData = plan.body.data as {
      rateMinor: string;
      timeBillingMode: string;
      billingUnitSeconds: number;
    };
    expect(planData.rateMinor).toBe("10000");
    expect(planData.timeBillingMode).toBe("PRORATED_HOUR");
    expect(planData.billingUnitSeconds).toBe(3600);
  });
});
