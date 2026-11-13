import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { coreUsers } from "@/db/schema";
import { GET as getMe } from "@/app/api/me/route";
import {
  GET as getCurrentOrganization,
  PATCH as patchCurrentOrganization,
} from "@/app/api/organizations/current/route";
import { POST as postSelectOrganization } from "@/app/api/organizations/select/route";
import { GET as getMemberships, POST as postMemberships } from "@/app/api/memberships/route";
import { PATCH as patchBranch } from "@/app/api/branches/[branchId]/route";
import { POST as postSignOut } from "@/app/api/auth/[...all]/route";
import { ORGANIZATION_COOKIE } from "@/app/api/_lib/handler";
import { betterAuthSignOutInit } from "@/auth/sign-out-http";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import { createUserWithMembership } from "@/modules/identity";
import {
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

describe("HTTP route authorization", () => {
  it("unauthenticated privileged route returns 401", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () => getMemberships());
    const { status, body } = await readJson(response);
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe("UNAUTHENTICATED");
  });

  it("authenticated user without membership is rejected", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-a",
    });
    await signUp(env.auth, { email: "stranger@x.com", password: "password-123", name: "Stranger" });
    const headers = await signInHeaders(env.auth, {
      email: "stranger@x.com",
      password: "password-123",
    });
    const response = await invokeHttp(
      env,
      { headers, organizationId: owner.organizationId },
      () => getMemberships(),
    );
    expect((await readJson(response)).status).toBe(403);
  });

  it("Organization A user with Organization B UUID is rejected", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-org-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-org-b",
    });

    const current = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerB.organizationId },
      () => getCurrentOrganization(),
    );
    expect((await readJson(current)).status).toBe(403);

    const select = await invokeHttp(env, { headers: ownerA.headers }, () =>
      postSelectOrganization(
        jsonRequest("POST", "http://localhost:3000/api/organizations/select", {
          organizationId: ownerB.organizationId,
        }),
      ),
    );
    expect((await readJson(select)).status).toBe(403);
  });

  it("missing permission returns 403; valid owner mutation succeeds", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-perm",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "plain@a.com", password: "password-123", displayName: "Plain" },
      createAuthAccountProvisioner(env.auth),
    );
    const plainHeaders = await signInHeaders(env.auth, {
      email: "plain@a.com",
      password: "password-123",
    });

    const forbidden = await invokeHttp(
      env,
      { headers: plainHeaders, organizationId: owner.organizationId },
      () =>
        postMemberships(
          jsonRequest("POST", "http://localhost:3000/api/memberships", {
            mode: "attach",
            email: "someone@x.com",
          }),
        ),
    );
    expect((await readJson(forbidden)).status).toBe(403);

    const updated = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        patchCurrentOrganization(
          jsonRequest("PATCH", "http://localhost:3000/api/organizations/current", {
            name: "HTTP Renamed",
          }),
        ),
    );
    const ok = await readJson(updated);
    expect(ok.status).toBe(200);
    expect((ok.body.data as { name: string }).name).toBe("HTTP Renamed");
  });

  it("invalid UUID path parameter returns 400", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-uuid",
    });
    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () =>
        patchBranch(
          jsonRequest("PATCH", "http://localhost:3000/api/branches/not-a-uuid", { name: "X" }),
          { params: Promise.resolve({ branchId: "not-a-uuid" }) },
        ),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe("INVALID_INPUT");
    expect(body.error).not.toHaveProperty("issues");
  });

  it("disabled Core User is rejected on a privileged route", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-disabled",
    });
    await env.db.update(coreUsers).set({ status: "DISABLED" }).where(eq(coreUsers.id, owner.userId));

    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => getMe(),
    );
    expect((await readJson(response)).status).toBe(403);
  });

  it("organization selector cookie cannot create access", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-sel-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "http-sel-b",
    });
    const response = await invokeHttp(
      env,
      { headers: ownerA.headers, organizationId: ownerB.organizationId },
      () => getMe(),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect((body.data as { current: unknown }).current).toBeNull();
  });

  it("cross-origin mutation is rejected", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-csrf",
    });
    const request = new Request("http://localhost:3000/api/organizations/current", {
      method: "PATCH",
      headers: (() => {
        const next = new Headers(owner.headers);
        next.set("content-type", "application/json");
        next.set("origin", "https://evil.example");
        return next;
      })(),
      body: JSON.stringify({ name: "Hacked" }),
    });
    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => patchCurrentOrganization(request),
    );
    expect((await readJson(response)).status).toBe(403);
  });

  it("sign-out clears the organization selector cookie after a successful Better Auth sign-out", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "http-signout",
    });
    const headers = new Headers(betterAuthSignOutInit().headers);
    const cookie = owner.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    const request = new Request("http://localhost:3000/api/auth/sign-out", {
      ...betterAuthSignOutInit(),
      headers,
    });
    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => postSignOut(request),
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.getSetCookie?.() ?? [];
    const cleared = setCookie.some(
      (cookie) => cookie.startsWith(`${ORGANIZATION_COOKIE}=`) && /Max-Age=0/i.test(cookie),
    );
    expect(cleared).toBe(true);
  });
});
