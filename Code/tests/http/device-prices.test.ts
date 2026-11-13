import { describe, expect, it } from "vitest";
import { POST as postDevicePrices } from "@/app/api/gaming/device-prices/route";
import { createDevice } from "@/modules/gaming";
import { PERMISSIONS } from "@/modules/identity";
import {
  createStaffMember,
  createTestEnvironment,
  invokeHttp,
  seedOwnerWithOrganization,
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

describe("device-prices HTTP", () => {
  it("unauthenticated create returns 401", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postDevicePrices(
        jsonRequest("POST", "http://localhost:3000/api/gaming/device-prices", {
          kind: "HOURLY",
          deviceIds: ["11111111-1111-4111-8111-111111111111"],
          priceMajor: "10000",
        }),
      ),
    );
    expect((await readJson(response)).status).toBe(401);
  });

  it("owner can create hourly device price; missing permission is 403", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-device-price",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const device = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      name: "PS5-1",
    });
    const created = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postDevicePrices(
          jsonRequest("POST", "http://localhost:3000/api/gaming/device-prices", {
            kind: "HOURLY",
            deviceIds: [device.id],
            priceMajor: "10,000",
          }),
        ),
    );
    const ok = await readJson(created);
    expect(ok.status).toBe(201);
    const data = ok.body.data as {
      plan: { name: string; rateMinor: string; timeBillingMode: string };
      assignments: Array<{ scopeType: string; scopeId: string }>;
    };
    expect(data.plan.name).toBe("PS5-1");
    expect(data.plan.rateMinor).toBe("10000");
    expect(data.plan.timeBillingMode).toBe("PRORATED_HOUR");
    expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0]?.scopeType).toBe("DEVICE");
    expect(data.assignments[0]?.scopeId).toBe(device.id);

    const staff = await createStaffMember(env, owner, {
      email: "plain@a.com",
      displayName: "Plain",
      roleCode: "NONE",
      permissions: [PERMISSIONS.branchesRead],
    });
    const forbidden = await invokeHttp(
      env,
      { headers: staff.headers, organizationId: owner.organizationId },
      () =>
        postDevicePrices(
          jsonRequest("POST", "http://localhost:3000/api/gaming/device-prices", {
            kind: "HOURLY",
            deviceIds: [device.id],
            priceMajor: "10000",
          }),
        ),
    );
    expect((await readJson(forbidden)).status).toBe(403);
  });

  it("owner can create an hourly price for a device type", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-type-price",
    });
    const seeded = await seedBranchAreaAndType(env, owner);
    const created = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postDevicePrices(
          jsonRequest("POST", "http://localhost:3000/api/gaming/device-prices", {
            kind: "HOURLY",
            deviceTypeIds: [seeded.deviceType.id],
            priceMajor: "10,000",
          }),
        ),
    );
    const ok = await readJson(created);
    expect(ok.status).toBe(201);
    const data = ok.body.data as {
      plan: { name: string };
      assignments: Array<{ scopeType: string; scopeId: string; branchId: string | null }>;
    };
    expect(data.plan.name).toBe("PC station");
    expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0]?.scopeType).toBe("DEVICE_TYPE");
    expect(data.assignments[0]?.scopeId).toBe(seeded.deviceType.id);
    expect(data.assignments[0]?.branchId).toBeNull();
  });
});
