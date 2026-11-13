import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { coreUsers } from "@/db/schema";
import { GET as getSettings } from "@/app/api/settings/route";
import { PUT as putSetting } from "@/app/api/settings/[key]/route";
import { GET as getCustomers, POST as postCustomers } from "@/app/api/customers/route";
import { GET as getCustomer, PATCH as patchCustomer } from "@/app/api/customers/[customerId]/route";
import { POST as postArchiveCustomer } from "@/app/api/customers/[customerId]/archive/route";
import { PUT as putBranchSetting } from "@/app/api/settings/[key]/branches/[branchId]/route";
import { createCustomer } from "@/modules/customers";
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

describe("settings and customers HTTP authorization", () => {
  it("unauthenticated settings and customers routes return 401", async () => {
    const env = await createTestEnvironment();
    const settings = await invokeHttp(env, { headers: new Headers() }, () =>
      getSettings(new Request("http://localhost:3000/api/settings")),
    );
    const customers = await invokeHttp(env, { headers: new Headers() }, () =>
      getCustomers(new Request("http://localhost:3000/api/customers")),
    );
    expect((await readJson(settings)).status).toBe(401);
    expect((await readJson(customers)).status).toBe(401);
  });

  it("authenticated user without membership is rejected", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m3-nomem",
    });
    await signUp(env.auth, { email: "stranger@x.com", password: "password-123", name: "Stranger" });
    const headers = await signInHeaders(env.auth, {
      email: "stranger@x.com",
      password: "password-123",
    });
    const response = await invokeHttp(
      env,
      { headers, organizationId: owner.organizationId },
      () => getCustomers(new Request("http://localhost:3000/api/customers")),
    );
    expect((await readJson(response)).status).toBe(403);
  });

  it("missing permission returns 403; owner can create a customer", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m3-perm",
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
      () => getCustomers(new Request("http://localhost:3000/api/customers")),
    );
    expect((await readJson(forbidden)).status).toBe(403);

    const created = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postCustomers(
          jsonRequest("POST", "http://localhost:3000/api/customers", { displayName: "Ahmad" }),
        ),
    );
    const ok = await readJson(created);
    expect(ok.status).toBe(201);
    expect((ok.body.data as { displayName: string }).displayName).toBe("Ahmad");
  });

  it("disabled Core User is rejected on customer routes", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m3-disabled",
    });
    await env.db.update(coreUsers).set({ status: "DISABLED" }).where(eq(coreUsers.id, owner.userId));
    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => getCustomers(new Request("http://localhost:3000/api/customers")),
    );
    expect((await readJson(response)).status).toBe(403);
  });

  it("cross-tenant customer UUID returns 404", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m3-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-m3-b",
    });
    const created = await invokeHttp(
      env,
      { headers: ownerB.headers, organizationId: ownerB.organizationId },
      () =>
        postCustomers(
          jsonRequest("POST", "http://localhost:3000/api/customers", { displayName: "Secret" }),
        ),
    );
    const customerId = ((await readJson(created)).body.data as { id: string }).id;
    const stolen = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerA.organizationId },
      () =>
        getCustomer(new Request(`http://localhost:3000/api/customers/${customerId}`), {
          params: Promise.resolve({ customerId }),
        }),
    );
    expect((await readJson(stolen)).status).toBe(404);
  });

  it("invalid setting type returns 400; branch override without access returns 403", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m3-set",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });
    const staff = await createStaffMember(env, owner, {
      email: "staff@a.com",
      displayName: "Staff",
      roleCode: "SET_ONLY",
      permissions: [PERMISSIONS.settingsRead, PERMISSIONS.settingsManage],
      branches: [],
    });

    const invalid = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        putSetting(
          jsonRequest("PUT", "http://localhost:3000/api/settings/gaming.allow_guest_sessions", {
            value: "yes",
          }),
          { params: Promise.resolve({ key: "gaming.allow_guest_sessions" }) },
        ),
    );
    expect((await readJson(invalid)).status).toBe(400);

    const denied = await invokeHttp(
      env,
      { headers: staff.headers, organizationId: owner.organizationId },
      () =>
        putBranchSetting(
          jsonRequest(
            "PUT",
            `http://localhost:3000/api/settings/gaming.billing_unit_seconds/branches/${branch.id}`,
            { value: 15 },
          ),
          { params: Promise.resolve({ key: "gaming.billing_unit_seconds", branchId: branch.id }) },
        ),
    );
    expect((await readJson(denied)).status).toBe(403);
  });

  it("archives a customer through the HTTP route", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-m3-arch",
    });
    const created = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postCustomers(
          jsonRequest("POST", "http://localhost:3000/api/customers", { displayName: "Temp" }),
        ),
    );
    const customerId = ((await readJson(created)).body.data as { id: string }).id;
    const archived = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        postArchiveCustomer(
          jsonRequest("POST", `http://localhost:3000/api/customers/${customerId}/archive`),
          { params: Promise.resolve({ customerId }) },
        ),
    );
    expect((await readJson(archived)).status).toBe(200);
    const patched = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        patchCustomer(
          jsonRequest("PATCH", `http://localhost:3000/api/customers/${customerId}`, {
            displayName: "Nope",
          }),
          { params: Promise.resolve({ customerId }) },
        ),
    );
    expect((await readJson(patched)).status).toBe(409);
  });

  it("returns bounded customer pages and rejects invalid paging inputs", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@pages.test",
      name: "Owner Pages",
      slug: "http-customer-pages",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    await createCustomer(env.db, context.actor, { displayName: "Page A" });
    await createCustomer(env.db, context.actor, { displayName: "Page B" });

    const getPage = async (query: string) =>
      invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
        getCustomers(new Request(`http://localhost:3000/api/customers${query}`)),
      );
    const first = await readJson(await getPage("?limit=1&offset=0"));
    const last = await readJson(await getPage("?limit=1&offset=1"));
    const empty = await readJson(await getPage("?limit=1&offset=2"));

    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.pagination).toEqual({ limit: 1, offset: 0, hasMore: true });
    expect(last.body.data).toHaveLength(1);
    expect(last.body.pagination).toEqual({ limit: 1, offset: 1, hasMore: false });
    expect(empty.body.data).toEqual([]);
    expect(empty.body.pagination).toEqual({ limit: 1, offset: 2, hasMore: false });

    for (const query of [
      "?limit=0",
      "?limit=101",
      "?limit=1.5",
      "?offset=-1",
      "?offset=1.5",
      "?offset=100001",
      "?offset=",
    ]) {
      expect((await readJson(await getPage(query))).status).toBe(400);
    }
  });
});
