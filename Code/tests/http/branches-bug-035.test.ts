import { describe, expect, it } from "vitest";
import { POST as postBranches } from "@/app/api/branches/route";
import { PATCH as patchBranch } from "@/app/api/branches/[branchId]/route";
import { BRANCH_NAME_IN_USE_REASON } from "@/modules/identity";
import { displayApiError } from "@/i18n/api-error";
import {
  createTestEnvironment,
  invokeHttp,
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

function errorPayload(body: Record<string, unknown>) {
  return body.error as { code?: string; message?: string; reason?: string };
}

describe("BUG-035 branch name HTTP uniqueness", () => {
  it("returns a localized conflict without leaking SQL when creating a duplicate name", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-branch-name",
    });
    const created = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => postBranches(jsonRequest("POST", "http://localhost:3000/api/branches", { name: "Main" })),
    );
    expect((await readJson(created)).status).toBe(201);

    const duplicate = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => postBranches(jsonRequest("POST", "http://localhost:3000/api/branches", { name: " Main " })),
    );
    const { status, body } = await readJson(duplicate);
    expect(status).toBe(409);
    const error = errorPayload(body);
    expect(error.code).toBe("CONFLICT");
    expect(error.reason).toBe(BRANCH_NAME_IN_USE_REASON);
    expect(error.message).not.toMatch(/sql|postgres|core_branches_org_name|constraint/i);
    expect(displayApiError(error, "ar")).toBe("يوجد فرع بهذا الاسم في هذا النشاط");
    expect(displayApiError(error, "en")).toBe("A branch with this name already exists in this organization");
    expect(displayApiError(error, "ar")).not.toBe(displayApiError(error, "en"));
  });

  it("allows the same name in another organization and rejects a colliding rename", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-branch-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-branch-b",
    });
    const firstA = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () => postBranches(jsonRequest("POST", "http://localhost:3000/api/branches", { name: "Main" })),
    );
    const firstBody = await readJson(firstA);
    expect(firstA.status).toBe(201);
    const original = firstBody.body.data as { id: string; name: string; code: string };

    const otherOrg = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () => postBranches(jsonRequest("POST", "http://localhost:3000/api/branches", { name: "Main" })),
    );
    expect((await readJson(otherOrg)).status).toBe(201);

    const second = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () => postBranches(jsonRequest("POST", "http://localhost:3000/api/branches", { name: "Side" })),
    );
    const secondId = ((await readJson(second)).body.data as { id: string }).id;

    const collision = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        patchBranch(jsonRequest("PATCH", `http://localhost:3000/api/branches/${secondId}`, { name: "main" }), {
          params: Promise.resolve({ branchId: secondId }),
        }),
    );
    const collided = await readJson(collision);
    expect(collided.status).toBe(409);
    expect(errorPayload(collided.body).reason).toBe(BRANCH_NAME_IN_USE_REASON);

    const uniqueRename = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        patchBranch(jsonRequest("PATCH", `http://localhost:3000/api/branches/${secondId}`, { name: "Side 2" }), {
          params: Promise.resolve({ branchId: secondId }),
        }),
    );
    expect((await readJson(uniqueRename)).status).toBe(200);
    expect(original.id).toBe((firstBody.body.data as { id: string }).id);
    expect(original.name).toBe("Main");
    expect(original.code.length).toBeGreaterThan(0);
  });
});
