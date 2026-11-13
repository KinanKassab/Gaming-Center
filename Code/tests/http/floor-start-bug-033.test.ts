import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getReports } from "@/app/api/reports/route";
import { GET as getSessions, POST as postSessions } from "@/app/api/gaming/sessions/route";
import { POST as postDevices } from "@/app/api/gaming/devices/route";
import { middleware } from "@/middleware";
import { createCustomer } from "@/modules/customers";
import { listSessions } from "@/modules/gaming";
import { FLOOR_START_API_PATH } from "@/ui/floor-start-form-safety";
import {
  createTestEnvironment,
  invokeHttp,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

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

describe("BUG-033 Floor Start HTTP", () => {
  it("does not start a session from native form-urlencoded POST to the Start API", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bug033-form",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const response = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postSessions(
        new Request(`http://localhost:3000${FLOOR_START_API_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "http://localhost:3000",
          },
          body: `deviceId=${seeded.device.id}&customerId=`,
        }),
      ),
    );
    expect((await readJson(response)).status).toBeGreaterThanOrEqual(400);
    const actor = (await resolveActor(env, owner.headers, owner.organizationId)).actor;
    const sessions = await listSessions(env.db, actor, { branchId: seeded.branch.id });
    expect(sessions).toHaveLength(0);
  });

  it("hydrated guest Start still uses JSON POST to the canonical Start API", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bug033-guest",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const requestUrl = `http://localhost:3000${FLOOR_START_API_PATH}`;
    const response = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postSessions(jsonRequest("POST", requestUrl, { deviceId: seeded.device.id })),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(201);
    expect((body.data as { customerId: string | null }).customerId).toBeNull();
    expect(requestUrl).not.toContain("customerId=");
  });

  it("hydrated customer Start still uses JSON POST to the canonical Start API", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bug033-cust",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const customer = await createCustomer(env.db, seeded.context.actor, { displayName: "Floor customer" });
    const requestUrl = `http://localhost:3000${FLOOR_START_API_PATH}`;
    const response = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postSessions(
        jsonRequest("POST", requestUrl, {
          deviceId: seeded.device.id,
          customerId: customer.customer.id,
        }),
      ),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(201);
    expect((body.data as { customerId: string }).customerId).toBe(customer.customer.id);
    expect(requestUrl).not.toContain(customer.customer.id);
    expect(requestUrl).not.toContain("customerId=");
  });

  it("repeated Start on the same device does not create a second session", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bug033-dup",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const first = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postSessions(
        jsonRequest("POST", `http://localhost:3000${FLOOR_START_API_PATH}`, { deviceId: seeded.device.id }),
      ),
    );
    expect((await readJson(first)).status).toBe(201);
    const second = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postSessions(
        jsonRequest("POST", `http://localhost:3000${FLOOR_START_API_PATH}`, { deviceId: seeded.device.id }),
      ),
    );
    expect((await readJson(second)).status).toBe(409);
    const listed = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      getSessions(new Request(`http://localhost:3000/api/gaming/sessions?branchId=${seeded.branch.id}&status=ACTIVE`)),
    );
    const json = await readJson(listed);
    expect(((json.body.data as unknown[]) ?? []).length).toBe(1);
  });

  it("still rejects starting a maintenance device", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bug033-mnt",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const created = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postDevices(
        jsonRequest("POST", "http://localhost:3000/api/gaming/devices", {
          branchId: seeded.branch.id,
          areaId: seeded.area.id,
          deviceTypeId: seeded.deviceType.id,
          code: "DOWN1",
          name: "Down",
          operationalStatus: "MAINTENANCE",
        }),
      ),
    );
    const deviceId = ((await readJson(created)).body.data as { id: string }).id;
    const start = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postSessions(jsonRequest("POST", `http://localhost:3000${FLOOR_START_API_PATH}`, { deviceId })),
    );
    expect((await readJson(start)).status).toBe(409);
  });

  it("native Floor POST is 303 See Other and does not keep customerId in the Location", () => {
    const request = new NextRequest("http://localhost:3000/admin/gaming/floor?branchId=working", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const response = middleware(request);
    expect(response.status).toBe(303);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/admin/gaming/floor");
    expect(location).toContain("branchId=working");
    expect(location).not.toContain("customerId");
  });

  it("GET Floor with leaked customerId is not middleware-redirected", () => {
    const response = middleware(
      new NextRequest("http://localhost:3000/admin/gaming/floor?customerId=11111111-1111-4111-8111-111111111111&branchId=working"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("BUG-036 Reports HTTP optional branchId", () => {
  it("omitted branchId is organization-wide across accessible branches", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "bug036-rep",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const started = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postSessions(
        jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seeded.device.id }),
      ),
    );
    expect((await readJson(started)).status).toBe(201);
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const all = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      getReports(new Request(`http://localhost:3000/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)),
    );
    const allJson = await readJson(all);
    expect(allJson.status).toBe(200);
    expect((allJson.body.data as { branchId: string | null }).branchId).toBeNull();
    const sessionCount = ((allJson.body.data as { sessionsByDay: Array<{ sessionCount: string }> }).sessionsByDay ?? [])
      .reduce((sum, row) => sum + Number(row.sessionCount), 0);
    // Active sessions remain in the session register, not the closed-and-paid income summary.
    expect(sessionCount).toBe(0);

    const filtered = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      getReports(
        new Request(
          `http://localhost:3000/api/reports?branchId=${seeded.branch.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ),
      ),
    );
    const filteredJson = await readJson(filtered);
    expect(filteredJson.status).toBe(200);
    expect((filteredJson.body.data as { branchId: string }).branchId).toBe(seeded.branch.id);
  });
});
