import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { coreUsers } from "@/db/schema";
import { GET as getCheckout } from "@/app/api/gaming/sessions/[sessionId]/checkout/route";
import { GET as getPayments, POST as postPayment } from "@/app/api/gaming/sessions/[sessionId]/payments/route";
import { GET as getPayment } from "@/app/api/finance/payments/[paymentId]/route";
import { PERMISSIONS } from "@/modules/identity";
import { finalizeSessionBilling } from "@/modules/gaming";
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
const paymentParams = (paymentId: string) => ({ params: Promise.resolve({ paymentId }) });

const T0 = new Date("2026-01-01T10:00:00.000Z");
function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

describe("finance checkout HTTP", () => {
  it("unauthenticated checkout and payment routes return 401", async () => {
    const env = await createTestEnvironment();
    const get = await invokeHttp(env, { headers: new Headers() }, () =>
      getCheckout(
        new Request("http://localhost:3000/api/gaming/sessions/00000000-0000-0000-0000-000000000001/checkout"),
        sessionParams("00000000-0000-0000-0000-000000000001"),
      ),
    );
    expect((await readJson(get)).status).toBe(401);
    const post = await invokeHttp(env, { headers: new Headers() }, () =>
      postPayment(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/gaming/sessions/00000000-0000-0000-0000-000000000001/payments",
          { amountMinor: "1", paymentMethodCode: "CASH" },
        ),
        sessionParams("00000000-0000-0000-0000-000000000001"),
      ),
    );
    expect((await readJson(post)).status).toBe(401);
  });

  it("rejects invalid UUID, no membership, missing permission, disabled user, and VIEW recording", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-pay-auth",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const invalid = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      getCheckout(
        new Request("http://localhost:3000/api/gaming/sessions/not-a-uuid/checkout"),
        sessionParams("not-a-uuid"),
      ),
    );
    expect((await readJson(invalid)).status).toBe(400);

    await signUp(env.auth, { email: "stranger@x.com", password: "password-123", name: "Stranger" });
    const stranger = await signInHeaders(env.auth, { email: "stranger@x.com", password: "password-123" });
    const noMem = await invokeHttp(env, { headers: stranger, organizationId: owner.organizationId }, () =>
      getCheckout(
        new Request(`http://localhost:3000/api/gaming/sessions/${seeded.device.id}/checkout`),
        sessionParams(seeded.device.id),
      ),
    );
    expect((await readJson(noMem)).status).toBe(403);

    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "101",
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);

    const plain = await createStaffMember(env, owner, {
      email: "plain@a.com",
      displayName: "Plain",
      roleCode: "NONE_PAY",
      permissions: [PERMISSIONS.branchesRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "MANAGE" }],
    });
    const forbidden = await invokeHttp(
      env,
      { headers: plain.headers, organizationId: owner.organizationId },
      () =>
        getCheckout(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/checkout`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(forbidden)).status).toBe(403);

    const disabled = await createStaffMember(env, owner, {
      email: "off@a.com",
      displayName: "Off",
      roleCode: "PAY_OFF",
      permissions: [PERMISSIONS.gamingSessionsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    await env.db.update(coreUsers).set({ status: "DISABLED" }).where(eq(coreUsers.id, disabled.userId));
    const disabledRes = await invokeHttp(
      env,
      { headers: disabled.headers, organizationId: owner.organizationId },
      () =>
        getCheckout(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/checkout`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(disabledRes)).status).toBe(403);

    const viewer = await createStaffMember(env, owner, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "PAY_VIEW_HTTP",
      permissions: [PERMISSIONS.gamingSessionsRead, PERMISSIONS.financePaymentsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const viewGet = await invokeHttp(
      env,
      { headers: viewer.headers, organizationId: owner.organizationId },
      () =>
        getCheckout(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/checkout`),
          sessionParams(sessionId),
        ),
    );
    const viewJson = await readJson(viewGet);
    expect(viewJson.status).toBe(200);
    expect((viewJson.body.data as { settlementStatus: string }).settlementStatus).toBe("UNPAID");

    const viewPay = await invokeHttp(
      env,
      { headers: viewer.headers, organizationId: owner.organizationId },
      () =>
        postPayment(
          jsonRequest(
            "POST",
            `http://localhost:3000/api/gaming/sessions/${sessionId}/payments`,
            { amountMinor: "200", paymentMethodCode: "CASH", idempotencyKey: "aaaaaaaa" },
          ),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(viewPay)).status).toBe(403);
  });

  it("lets OPERATE record payment, replays idempotent retries, and hides cross-tenant ids", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-pay-ok",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-pay-b",
    });
    const seeded = await seedPlayableDevice(env, ownerA);
    await seedPlayableDevice(env, ownerB, { branchCode: "MZB" });
    const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "102",
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);

    const noGrant = await createStaffMember(env, ownerA, {
      email: "nogrant@a.com",
      displayName: "No grant",
      roleCode: "NO_GRANT_PAY",
      permissions: [PERMISSIONS.gamingSessionsRead, PERMISSIONS.financePaymentsCreate],
      branches: [],
    });
    const noGrantRes = await invokeHttp(
      env,
      { headers: noGrant.headers, organizationId: ownerA.organizationId },
      () =>
        postPayment(
          jsonRequest(
            "POST",
            `http://localhost:3000/api/gaming/sessions/${sessionId}/payments`,
            { amountMinor: "200", paymentMethodCode: "CASH", idempotencyKey: "bbbbbbbb" },
          ),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(noGrantRes)).status).toBe(403);

    const operator = await createStaffMember(env, ownerA, {
      email: "op@a.com",
      displayName: "Operator",
      roleCode: "PAY_OP_HTTP",
      permissions: [PERMISSIONS.gamingSessionsRead, PERMISSIONS.financePaymentsCreate],
      branches: [{ branchId: seeded.branch.id, accessMode: "OPERATE" }],
    });
    const missingKey = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: ownerA.organizationId },
      () =>
        postPayment(
          jsonRequest(
            "POST",
            `http://localhost:3000/api/gaming/sessions/${sessionId}/payments`,
            { amountMinor: "200", paymentMethodCode: "CASH" },
          ),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(missingKey)).status).toBe(400);

    const first = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: ownerA.organizationId },
      () =>
        postPayment(
          jsonRequest(
            "POST",
            `http://localhost:3000/api/gaming/sessions/${sessionId}/payments`,
            { amountMinor: "200", paymentMethodCode: "CASH", idempotencyKey: "cccccccc" },
          ),
          sessionParams(sessionId),
        ),
    );
    const firstJson = await readJson(first);
    expect(firstJson.status).toBe(201);
    const paymentId = (firstJson.body.data as { id: string }).id;
    expect((firstJson.body.data as { amountMinor: string }).amountMinor).toBe("200");

    const retry = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: ownerA.organizationId },
      () =>
        postPayment(
          jsonRequest(
            "POST",
            `http://localhost:3000/api/gaming/sessions/${sessionId}/payments`,
            { amountMinor: "200", paymentMethodCode: "CASH", idempotencyKey: "cccccccc" },
          ),
          sessionParams(sessionId),
        ),
    );
    const retryJson = await readJson(retry);
    expect(retryJson.status).toBe(200);
    expect(retryJson.body.replayed).toBe(true);
    expect((retryJson.body.data as { id: string }).id).toBe(paymentId);

    const contradict = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: ownerA.organizationId },
      () =>
        postPayment(
          jsonRequest(
            "POST",
            `http://localhost:3000/api/gaming/sessions/${sessionId}/payments`,
            { amountMinor: "200", paymentMethodCode: "SHAMCASH", idempotencyKey: "cccccccc" },
          ),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(contradict)).status).toBe(409);

    const settled = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: ownerA.organizationId },
      () =>
        postPayment(
          jsonRequest(
            "POST",
            `http://localhost:3000/api/gaming/sessions/${sessionId}/payments`,
            { amountMinor: "200", paymentMethodCode: "CASH", idempotencyKey: "dddddddd" },
          ),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(settled)).status).toBe(409);

    const list = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: ownerA.organizationId },
      () =>
        getPayments(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/payments`),
          sessionParams(sessionId),
        ),
    );
    const listJson = await readJson(list);
    expect(listJson.status).toBe(200);
    expect((listJson.body.data as unknown[]).length).toBe(1);

    const byId = await invokeHttp(
      env,
      { headers: operator.headers, organizationId: ownerA.organizationId },
      () =>
        getPayment(
          new Request(`http://localhost:3000/api/finance/payments/${paymentId}`),
          paymentParams(paymentId),
        ),
    );
    expect((await readJson(byId)).status).toBe(200);

    const cross = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () =>
        getCheckout(
          new Request(`http://localhost:3000/api/gaming/sessions/${sessionId}/checkout`),
          sessionParams(sessionId),
        ),
    );
    expect((await readJson(cross)).status).toBe(404);
    const crossPay = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () =>
        getPayment(
          new Request(`http://localhost:3000/api/finance/payments/${paymentId}`),
          paymentParams(paymentId),
        ),
    );
    expect((await readJson(crossPay)).status).toBe(404);
  });
});
