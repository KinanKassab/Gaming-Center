import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { coreUsers } from "@/db/schema";
import { GET as getFloor } from "@/app/api/gaming/floor/route";
import { GET as getSessions, POST as postSessions } from "@/app/api/gaming/sessions/route";
import { GET as getSession } from "@/app/api/gaming/sessions/[sessionId]/route";
import { POST as postPause } from "@/app/api/gaming/sessions/[sessionId]/pause/route";
import { POST as postResume } from "@/app/api/gaming/sessions/[sessionId]/resume/route";
import { POST as postEnd } from "@/app/api/gaming/sessions/[sessionId]/end/route";
import { POST as postDevices } from "@/app/api/gaming/devices/route";
import { createCustomer } from "@/modules/customers";
import { PERMISSIONS } from "@/modules/identity";
import { setOrganizationSetting } from "@/modules/settings";
import { createPricingAssignment } from "@/modules/gaming";
import {
  createStaffMember,
  createTestEnvironment,
  invokeHttp,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
  signUp,
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

const sessionParams = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });

describe("gaming session HTTP authorization", () => {
  it("unauthenticated session routes return 401", async () => {
    const env = await createTestEnvironment();
    const floor = await invokeHttp(env, { headers: new Headers() }, () =>
      getFloor(new Request("http://localhost:3000/api/gaming/floor?branchId=00000000-0000-0000-0000-000000000001")),
    );
    expect((await readJson(floor)).status).toBe(401);
  });

  it("authenticated user without membership cannot start a session", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m5-nomem",
    });
    const seeded = await seedPlayableDevice(env, owner);
    await signUp(env.auth, { email: "stranger@x.com", password: "password-123", name: "Stranger" });
    const headers = await signInHeaders(env.auth, { email: "stranger@x.com", password: "password-123" });
    const response = await invokeHttp(env, { headers, organizationId: owner.organizationId }, () =>
      postSessions(
        jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seeded.device.id }),
      ),
    );
    expect((await readJson(response)).status).toBe(403);
  });

  it("missing permission, disabled user, and missing branch grant are rejected", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m5-perm",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const plain = await createStaffMember(env, owner, {
      email: "plain@a.com",
      displayName: "Plain",
      roleCode: "NONE",
      permissions: [PERMISSIONS.branchesRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "MANAGE" }],
    });
    const forbidden = await invokeHttp(
      env,
      { headers: plain.headers, organizationId: owner.organizationId },
      () => getFloor(new Request(`http://localhost:3000/api/gaming/floor?branchId=${seeded.branch.id}`)),
    );
    expect((await readJson(forbidden)).status).toBe(403);

    const disabled = await createStaffMember(env, owner, {
      email: "off@a.com",
      displayName: "Off",
      roleCode: "FLOOR_OFF",
      permissions: [PERMISSIONS.gamingSessionsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    await env.db.update(coreUsers).set({ status: "DISABLED" }).where(eq(coreUsers.id, disabled.userId));
    const disabledRes = await invokeHttp(
      env,
      { headers: disabled.headers, organizationId: owner.organizationId },
      () => getSessions(new Request("http://localhost:3000/api/gaming/sessions")),
    );
    expect((await readJson(disabledRes)).status).toBe(403);

    const noGrant = await createStaffMember(env, owner, {
      email: "nogrant@a.com",
      displayName: "No grant",
      roleCode: "NO_GRANT",
      permissions: [
        PERMISSIONS.gamingSessionsRead,
        PERMISSIONS.gamingSessionsStart,
        PERMISSIONS.gamingSessionsOperate,
      ],
      branches: [],
    });
    const startDenied = await invokeHttp(
      env,
      { headers: noGrant.headers, organizationId: owner.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seeded.device.id }),
        ),
    );
    expect((await readJson(startDenied)).status).toBe(403);
  });

  it("VIEW can read the floor but cannot start; OPERATE can run the lifecycle", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m5-view",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const viewer = await createStaffMember(env, owner, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "VIEW",
      permissions: [
        PERMISSIONS.gamingSessionsRead,
        PERMISSIONS.gamingSessionsStart,
        PERMISSIONS.gamingSessionsOperate,
      ],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const floor = await invokeHttp(
      env,
      { headers: viewer.headers, organizationId: owner.organizationId },
      () => getFloor(new Request(`http://localhost:3000/api/gaming/floor?branchId=${seeded.branch.id}`)),
    );
    expect((await readJson(floor)).status).toBe(200);
    const startView = await invokeHttp(
      env,
      { headers: viewer.headers, organizationId: owner.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seeded.device.id }),
        ),
    );
    expect((await readJson(startView)).status).toBe(403);

    const operator = await createStaffMember(env, owner, {
      email: "op@a.com",
      displayName: "Operator",
      roleCode: "OP",
      permissions: [
        PERMISSIONS.gamingSessionsRead,
        PERMISSIONS.gamingSessionsStart,
        PERMISSIONS.gamingSessionsOperate,
      ],
      branches: [{ branchId: seeded.branch.id, accessMode: "OPERATE" }],
    });
    const created = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: owner.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seeded.device.id }),
        ),
    );
    const createdJson = await readJson(created);
    expect(createdJson.status).toBe(201);
    const sessionId = (createdJson.body.data as { id: string }).id;

    const paused = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: owner.organizationId },
      () => postPause(jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/pause`, {}), sessionParams(sessionId)),
    );
    expect((await readJson(paused)).status).toBe(200);
    const resumed = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: owner.organizationId },
      () => postResume(jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/resume`), sessionParams(sessionId)),
    );
    expect((await readJson(resumed)).status).toBe(200);
    const ended = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: owner.organizationId },
      () => postEnd(jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/end`), sessionParams(sessionId)),
    );
    expect((await readJson(ended)).status).toBe(200);
  });

  it("rejects cross-tenant device, customer, and session UUIDs without leaking them", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m5-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-m5-b",
    });
    const seededA = await seedPlayableDevice(env, ownerA, { branchCode: "A1" });
    const seededB = await seedPlayableDevice(env, ownerB, { branchCode: "B1" });
    const customerB = await createCustomer(env.db, seededB.context.actor, { displayName: "B player" });
    const startedB = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seededB.device.id }),
        ),
    );
    const sessionB = ((await readJson(startedB)).body.data as { id: string }).id;

    const startBDevice = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seededB.device.id }),
        ),
    );
    expect((await readJson(startBDevice)).status).toBe(404);

    const startBCustomer = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", {
            deviceId: seededA.device.id,
            customerId: customerB.customer.id,
          }),
        ),
    );
    expect((await readJson(startBCustomer)).status).toBe(404);

    const getB = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () => getSession(new Request(`http://localhost:3000/api/gaming/sessions/${sessionB}`), sessionParams(sessionB)),
    );
    expect((await readJson(getB)).status).toBe(404);

    const endB = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        postEnd(
          jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionB}/end`),
          sessionParams(sessionB),
        ),
    );
    expect((await readJson(endB)).status).toBe(404);

    const invalid = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () => getSession(new Request("http://localhost:3000/api/gaming/sessions/not-a-uuid"), sessionParams("not-a-uuid")),
    );
    expect((await readJson(invalid)).status).toBe(400);
  });

  it("rejects occupied, maintenance, guest-disabled, and invalid transition requests", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m5-conflict",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const first = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seeded.device.id }),
        ),
    );
    expect((await readJson(first)).status).toBe(201);
    const second = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seeded.device.id }),
        ),
    );
    expect((await readJson(second)).status).toBe(409);

    const maintenance = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postDevices(
          jsonRequest("POST", "http://localhost:3000/api/gaming/devices", {
            branchId: seeded.branch.id,
            areaId: seeded.area.id,
            deviceTypeId: seeded.deviceType.id,
            code: "PC99",
            name: "Down",
            operationalStatus: "MAINTENANCE",
          }),
        ),
    );
    const maintenanceId = ((await readJson(maintenance)).body.data as { id: string }).id;
    const startMaint = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postSessions(jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: maintenanceId })),
    );
    expect((await readJson(startMaint)).status).toBe(409);

    const disabled = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postDevices(
          jsonRequest("POST", "http://localhost:3000/api/gaming/devices", {
            branchId: seeded.branch.id,
            areaId: seeded.area.id,
            deviceTypeId: seeded.deviceType.id,
            code: "PC97",
            name: "Disabled",
            operationalStatus: "DISABLED",
          }),
        ),
    );
    const disabledId = ((await readJson(disabled)).body.data as { id: string }).id;
    const startDisabled = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postSessions(jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: disabledId })),
    );
    expect((await readJson(startDisabled)).status).toBe(409);

    const context = await resolveActor(env, owner.headers, owner.organizationId);
    await setOrganizationSetting(env.db, context.actor, "gaming.allow_guest_sessions", { value: false });
    const otherDevice = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postDevices(
          jsonRequest("POST", "http://localhost:3000/api/gaming/devices", {
            branchId: seeded.branch.id,
            areaId: seeded.area.id,
            deviceTypeId: seeded.deviceType.id,
            code: "PC98",
            name: "Guestless",
          }),
        ),
    );
    const otherId = ((await readJson(otherDevice)).body.data as { id: string }).id;
    await createPricingAssignment(env.db, context.actor, {
      pricingPlanId: seeded.plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: otherId,
    });
    const guestDenied = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => postSessions(jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: otherId })),
    );
    expect((await readJson(guestDenied)).status).toBe(409);

    const customer = await createCustomer(env.db, context.actor, { displayName: "Named" });
    const guestOk = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", {
            deviceId: otherId,
            customerId: customer.customer.id,
          }),
        ),
    );
    const guestJson = await readJson(guestOk);
    expect(guestJson.status).toBe(201);

    const sessionId = (guestJson.body.data as { id: string }).id;
    const resumeActive = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postResume(
          jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/resume`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(resumeActive)).status).toBe(409);
  });
});
