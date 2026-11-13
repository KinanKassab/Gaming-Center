import { describe, expect, it } from "vitest";
import { POST as postExpense } from "@/app/api/finance/expenses/route";
import { createBranch, PERMISSIONS } from "@/modules/identity";
import {
  createStaffMember,
  createTestEnvironment,
  invokeHttp,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";

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

describe("HTTP finance expenses", () => {
  it("requires auth, OPERATE to post, and replays an identical idempotency key", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-exp",
    });
    let context = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, context.actor, { name: "Main" });
    context = await resolveActor(env, owner.headers, owner.organizationId);

    const anonymous = await invokeHttp(env, { headers: new Headers() }, () =>
      postExpense(
        jsonRequest("POST", "http://localhost:3000/api/finance/expenses", {
          branchId: branch.id,
          amountMinor: "2000",
          description: "Water",
          idempotencyKey: "aaaaaaaa",
        }),
      ),
    );
    expect((await readJson(anonymous)).status).toBe(401);

    const viewer = await createStaffMember(env, owner, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "EXP_HTTP_VIEW",
      permissions: [PERMISSIONS.financeExpensesRead, PERMISSIONS.financeExpensesCreate],
      branches: [{ branchId: branch.id, accessMode: "VIEW" }],
    });
    const viewPost = await invokeHttp(
      env,
      { headers: viewer.headers, organizationId: owner.organizationId },
      () =>
        postExpense(
          jsonRequest("POST", "http://localhost:3000/api/finance/expenses", {
            branchId: branch.id,
            amountMinor: "2000",
            description: "Water",
            idempotencyKey: "bbbbbbbb",
          }),
        ),
    );
    expect((await readJson(viewPost)).status).toBe(403);

    const cashier = await createStaffMember(env, owner, {
      email: "cash@a.com",
      displayName: "Cashier",
      roleCode: "EXP_HTTP_CASH",
      permissions: [PERMISSIONS.financeExpensesRead, PERMISSIONS.financeExpensesCreate],
      branches: [{ branchId: branch.id, accessMode: "OPERATE" }],
    });
    const created = await invokeHttp(
      env,
      { headers: cashier.headers, organizationId: owner.organizationId },
      () =>
        postExpense(
          jsonRequest("POST", "http://localhost:3000/api/finance/expenses", {
            branchId: branch.id,
            amountMinor: "2000",
            description: "Water",
            idempotencyKey: "cccccccc",
          }),
        ),
    );
    const createdJson = await readJson(created);
    expect(createdJson.status).toBe(201);
    const expense = createdJson.body.data as { id: string; amountMinor: string };
    expect(expense.amountMinor).toBe("2000");

    const replay = await invokeHttp(
      env,
      { headers: cashier.headers, organizationId: owner.organizationId },
      () =>
        postExpense(
          jsonRequest("POST", "http://localhost:3000/api/finance/expenses", {
            branchId: branch.id,
            amountMinor: "2000",
            description: "Water",
            idempotencyKey: "cccccccc",
          }),
        ),
    );
    const replayJson = await readJson(replay);
    expect(replayJson.status).toBe(200);
    expect(replayJson.body.replayed).toBe(true);
    expect((replayJson.body.data as { id: string }).id).toBe(expense.id);

    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-exp-b",
    });
    const cross = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () =>
        postExpense(
          jsonRequest("POST", "http://localhost:3000/api/finance/expenses", {
            branchId: branch.id,
            amountMinor: "2000",
            description: "Steal",
            idempotencyKey: "dddddddd",
          }),
        ),
    );
    expect((await readJson(cross)).status).toBe(403);
    expect(context.actor.organizationId).toBe(owner.organizationId);
  });
});
