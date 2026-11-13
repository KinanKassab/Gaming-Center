import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { coreUsers } from "@/db/schema";
import { GET as getBilling } from "@/app/api/gaming/sessions/[sessionId]/billing/route";
import { POST as postFinalize } from "@/app/api/gaming/sessions/[sessionId]/billing/finalize/route";
import { POST as postSessions } from "@/app/api/gaming/sessions/route";
import { POST as postEnd } from "@/app/api/gaming/sessions/[sessionId]/end/route";
import { PERMISSIONS } from "@/modules/identity";
import {
  createStaffMember,
  createTestEnvironment,
  invokeHttp,
  seedOwnerWithOrganization,
  signInHeaders,
  signUp,
} from "../helpers/identity";
import { insertCompletedUnbilledSession, seedPlayableDevice } from "../helpers/gaming";

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

const T0 = new Date("2026-01-01T10:00:00.000Z");
function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

describe("gaming billing HTTP", () => {
  it("unauthenticated billing routes return 401", async () => {
    const env = await createTestEnvironment();
    const get = await invokeHttp(env, { headers: new Headers() }, () =>
      getBilling(
        new Request("http://localhost:3000/api/gaming/sessions/00000000-0000-0000-0000-000000000001/billing"),
        sessionParams("00000000-0000-0000-0000-000000000001"),
      ),
    );
    expect((await readJson(get)).status).toBe(401);
    const post = await invokeHttp(env, { headers: new Headers() }, () =>
      postFinalize(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/gaming/sessions/00000000-0000-0000-0000-000000000001/billing/finalize",
        ),
        sessionParams("00000000-0000-0000-0000-000000000001"),
      ),
    );
    expect((await readJson(post)).status).toBe(401);
  });

  it("rejects invalid UUID, no membership, missing permission, disabled user, and missing grant", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-bill-auth",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const invalid = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      getBilling(new Request("http://localhost:3000/api/gaming/sessions/not-a-uuid/billing"), sessionParams("not-a-uuid")),
    );
    expect((await readJson(invalid)).status).toBe(400);

    await signUp(env.auth, { email: "stranger@x.com", password: "password-123", name: "Stranger" });
    const stranger = await signInHeaders(env.auth, { email: "stranger@x.com", password: "password-123" });
    const noMem = await invokeHttp(env, { headers: stranger, organizationId: owner.organizationId }, () =>
      getBilling(
        new Request(`http://localhost:3000/api/gaming/sessions/${seeded.device.id}/billing`),
        sessionParams(seeded.device.id),
      ),
    );
    expect((await readJson(noMem)).status).toBe(403);

    const plain = await createStaffMember(env, owner, {
      email: "plain@a.com",
      displayName: "Plain",
      roleCode: "NONE",
      permissions: [PERMISSIONS.branchesRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "MANAGE" }],
    });
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "81",
    });
    const forbidden = await invokeHttp(
      env,
      { headers: plain.headers, organizationId: owner.organizationId },
      () =>
        getBilling(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/billing`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(forbidden)).status).toBe(403);

    const disabled = await createStaffMember(env, owner, {
      email: "off@a.com",
      displayName: "Off",
      roleCode: "BILL_OFF",
      permissions: [PERMISSIONS.gamingSessionsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    await env.db.update(coreUsers).set({ status: "DISABLED" }).where(eq(coreUsers.id, disabled.userId));
    const disabledRes = await invokeHttp(
      env,
      { headers: disabled.headers, organizationId: owner.organizationId },
      () =>
        getBilling(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/billing`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(disabledRes)).status).toBe(403);

    const noGrant = await createStaffMember(env, owner, {
      email: "nogrant@a.com",
      displayName: "No grant",
      roleCode: "NO_GRANT_BILL",
      permissions: [PERMISSIONS.gamingSessionsRead, PERMISSIONS.gamingSessionsOperate],
      branches: [],
    });
    const noGrantRes = await invokeHttp(
      env,
      { headers: noGrant.headers, organizationId: owner.organizationId },
      () =>
        postFinalize(
          jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/billing/finalize`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(noGrantRes)).status).toBe(403);
  });

  it("VIEW may read billing; OPERATE may finalize; retries stay idempotent", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-bill-ok",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "82",
    });

    const viewer = await createStaffMember(env, owner, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "BILL_VIEW",
      permissions: [PERMISSIONS.gamingSessionsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const preview = await invokeHttp(
      env,
      { headers: viewer.headers, organizationId: owner.organizationId },
      () =>
        getBilling(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/billing`),
          sessionParams(sessionId),
        ),
    );
    const previewJson = await readJson(preview);
    expect(previewJson.status).toBe(200);
    expect((previewJson.body.data as { status: string }).status).toBe("UNFINALIZED");

    const viewFinalize = await invokeHttp(
      env,
      { headers: viewer.headers, organizationId: owner.organizationId },
      () =>
        postFinalize(
          jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/billing/finalize`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(viewFinalize)).status).toBe(403);

    const operator = await createStaffMember(env, owner, {
      email: "op@a.com",
      displayName: "Operator",
      roleCode: "BILL_OP",
      permissions: [PERMISSIONS.gamingSessionsRead, PERMISSIONS.gamingSessionsOperate],
      branches: [{ branchId: seeded.branch.id, accessMode: "OPERATE" }],
    });
    const first = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: owner.organizationId },
      () =>
        postFinalize(
          jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/billing/finalize`),
          sessionParams(sessionId),
        ),
    );
    const firstJson = await readJson(first);
    expect(firstJson.status).toBe(200);
    expect((firstJson.body.data as { status: string; result: { totalMinor: string } }).status).toBe(
      "FINALIZED",
    );
    expect((firstJson.body.data as { result: { totalMinor: string } }).result.totalMinor).toBe("200");

    const second = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: owner.organizationId },
      () =>
        postFinalize(
          jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/billing/finalize`),
          sessionParams(sessionId),
        ),
    );
    const secondJson = await readJson(second);
    expect(secondJson.status).toBe(200);
    expect((secondJson.body.data as { result: { totalMinor: string } }).result.totalMinor).toBe("200");
  });

  it("rejects finalize for an open session and hides a cross-tenant id", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-bill-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-bill-b",
    });
    const seededA = await seedPlayableDevice(env, ownerA);
    await seedPlayableDevice(env, ownerB, { branchCode: "MZB" });
    const created = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        postSessions(
          jsonRequest("POST", "http://localhost:3000/api/gaming/sessions", { deviceId: seededA.device.id }),
        ),
    );
    const createdJson = await readJson(created);
    expect(createdJson.status).toBe(201);
    const sessionId = (createdJson.body.data as { id: string }).id;

    const openFinalize = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        postFinalize(
          jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/billing/finalize`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(openFinalize)).status).toBe(409);

    const cross = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () =>
        getBilling(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/billing`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(cross)).status).toBe(404);

    const ended = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        postEnd(
          jsonRequest("POST", `http://localhost:3000/api/gaming/sessions/${sessionId}/end`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(ended)).status).toBe(200);
    const billed = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        getBilling(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/billing`),
          sessionParams(sessionId),
        ),
    );
    const billedJson = await readJson(billed);
    expect(billedJson.status).toBe(200);
    expect((billedJson.body.data as { status: string }).status).toBe("FINALIZED");
  });
});
