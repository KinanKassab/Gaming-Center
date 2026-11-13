import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postAuth } from "@/app/api/auth/[...all]/route";
import { POST as postOrganizations } from "@/app/api/organizations/route";
import { GET as getSetupStatus } from "@/app/api/setup/status/route";
import { POST as postMemberships } from "@/app/api/memberships/route";
import { FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER } from "@/core/env";
import { coreUsers } from "@/db/schema";
import { listPermissionCatalog, listMemberships } from "@/modules/identity";
import {
  createStaffMember,
  createTestEnvironment,
  invokeHttp,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
} from "../helpers/identity";

const BOOTSTRAP_TOKEN = "test-bootstrap-token";

function jsonRequest(
  method: string,
  url: string,
  body?: unknown,
  extra?: { token?: string; cookie?: Headers },
): Request {
  const headers = extra?.cookie ? new Headers(extra.cookie) : new Headers();
  headers.set("content-type", "application/json");
  headers.set("origin", "http://localhost:3000");
  if (extra?.token) headers.set(FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER, extra.token);
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

describe("first-owner HTTP bootstrap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("A: public signup without bootstrap token is denied", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest("POST", "http://localhost:3000/api/auth/sign-up/email", {
          email: "owner@example.com",
          password: "password-123",
          name: "Owner",
        }),
      ),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("FORBIDDEN");
    const users = await env.db.select({ id: coreUsers.id }).from(coreUsers);
    expect(users).toHaveLength(0);
  });

  it("B: incorrect bootstrap token is denied", async () => {
    vi.stubEnv("GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN", BOOTSTRAP_TOKEN);
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/auth/sign-up/email",
          { email: "owner@example.com", password: "password-123", name: "Owner" },
          { token: "wrong-bootstrap-tok" },
        ),
      ),
    );
    const { status } = await readJson(response);
    expect(status).toBe(403);
    const users = await env.db.select({ id: coreUsers.id }).from(coreUsers);
    expect(users).toHaveLength(0);
  });

  it("C/F/I: correct token creates the first account; sign-in and initial org OWNER work", async () => {
    vi.stubEnv("GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN", BOOTSTRAP_TOKEN);
    const env = await createTestEnvironment();

    const statusOpen = await invokeHttp(env, { headers: new Headers() }, () => getSetupStatus());
    const openBody = await readJson(statusOpen);
    expect(openBody.status).toBe(200);
    expect((openBody.body.data as { firstUserRequired: boolean }).firstUserRequired).toBe(true);

    const signedUp = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/auth/sign-up/email",
          { email: "owner@example.com", password: "password-123", name: "Owner" },
          { token: BOOTSTRAP_TOKEN },
        ),
      ),
    );
    expect(signedUp.status).toBeGreaterThanOrEqual(200);
    expect(signedUp.status).toBeLessThan(300);

    const users = await env.db.select().from(coreUsers);
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("owner@example.com");

    const signIn = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest("POST", "http://localhost:3000/api/auth/sign-in/email", {
          email: "owner@example.com",
          password: "password-123",
        }),
      ),
    );
    expect(signIn.status).toBeGreaterThanOrEqual(200);
    expect(signIn.status).toBeLessThan(300);

    const sessionHeaders = await signInHeaders(env.auth, {
      email: "owner@example.com",
      password: "password-123",
    });
    const createdOrg = await invokeHttp(env, { headers: sessionHeaders }, () =>
      postOrganizations(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/organizations",
          {
            slug: "dragon-gaming",
            name: "Dragon Gaming",
            defaultCurrency: "SYP",
            timezone: "Asia/Damascus",
            locale: "ar",
          },
          { cookie: sessionHeaders },
        ),
      ),
    );
    const orgJson = await readJson(createdOrg);
    expect(orgJson.status).toBe(201);
    const organizationId = (orgJson.body.data as { organizationId: string; ownerRoleId: string })
      .organizationId;
    const ownerRoleId = (orgJson.body.data as { ownerRoleId: string }).ownerRoleId;

    const context = await resolveActor(env, sessionHeaders, organizationId);
    const catalog = await listPermissionCatalog(env.db, context.actor);
    expect(context.actor.permissions).toHaveLength(catalog.length);
    expect(context.actor.permissions).toEqual(expect.arrayContaining(catalog.map((row) => row.code)));

    const memberships = await listMemberships(env.db, context.actor);
    expect(memberships.some((row) => row.status === "ACTIVE" && row.roles.some((role) => role.code === "OWNER"))).toBe(
      true,
    );
    expect(ownerRoleId).toBeTruthy();
    expect(context.actor.membershipId).toBeTruthy();

    const statusClosed = await invokeHttp(env, { headers: new Headers() }, () => getSetupStatus());
    expect(
      ((await readJson(statusClosed)).body.data as { firstUserRequired: boolean }).firstUserRequired,
    ).toBe(false);
  });

  it("D: second public signup is denied even with the correct token", async () => {
    vi.stubEnv("GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN", BOOTSTRAP_TOKEN);
    const env = await createTestEnvironment();
    const first = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/auth/sign-up/email",
          { email: "owner@example.com", password: "password-123", name: "Owner" },
          { token: BOOTSTRAP_TOKEN },
        ),
      ),
    );
    expect(first.ok).toBe(true);

    const second = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/auth/sign-up/email",
          { email: "other@example.com", password: "password-123", name: "Other" },
          { token: BOOTSTRAP_TOKEN },
        ),
      ),
    );
    const { status, body } = await readJson(second);
    expect(status).toBe(409);
    expect((body.error as { code: string }).code).toBe("CONFLICT");
    const users = await env.db.select({ email: coreUsers.email }).from(coreUsers);
    expect(users.map((row) => row.email)).toEqual(["owner@example.com"]);
  });

  it("E: concurrent first-user HTTP signups create only one identity", async () => {
    vi.stubEnv("GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN", BOOTSTRAP_TOKEN);
    const env = await createTestEnvironment();
    const settled = await Promise.allSettled([
      invokeHttp(env, { headers: new Headers() }, () =>
        postAuth(
          jsonRequest(
            "POST",
            "http://localhost:3000/api/auth/sign-up/email",
            { email: "one@example.com", password: "password-123", name: "One" },
            { token: BOOTSTRAP_TOKEN },
          ),
        ),
      ),
      invokeHttp(env, { headers: new Headers() }, () =>
        postAuth(
          jsonRequest(
            "POST",
            "http://localhost:3000/api/auth/sign-up/email",
            { email: "two@example.com", password: "password-123", name: "Two" },
            { token: BOOTSTRAP_TOKEN },
          ),
        ),
      ),
    ]);
    const responses = settled
      .filter((result): result is PromiseFulfilledResult<Response> => result.status === "fulfilled")
      .map((result) => result.value);
    const successes = responses.filter((response) => response.status >= 200 && response.status < 300);
    expect(successes.length).toBeLessThanOrEqual(1);
    const users = await env.db.select({ id: coreUsers.id }).from(coreUsers);
    expect(users).toHaveLength(1);
  });

  it("G: OWNER can still provision staff via createAuthAccountProvisioner / memberships API", async () => {
    vi.stubEnv("GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN", BOOTSTRAP_TOKEN);
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "staff-org",
    });
    const created = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postMemberships(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/memberships",
          {
            mode: "create",
            email: "cashier@a.com",
            password: "password-123",
            displayName: "Cashier",
          },
          { cookie: owner.headers },
        ),
      ),
    );
    const { status, body } = await readJson(created);
    expect(status).toBe(201);
    expect((body.data as { userId: string }).userId).toBeTruthy();

    const staffHeaders = await signInHeaders(env.auth, {
      email: "cashier@a.com",
      password: "password-123",
    });
    expect(staffHeaders.get("cookie")).toBeTruthy();
  });

  it("H: authenticated staff cannot create another organization after the initial one", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "only-one",
    });
    const staff = await createStaffMember(env, owner, {
      email: "staff@a.com",
      displayName: "Staff",
      roleCode: "STAFF",
      permissions: [],
    });

    const asStaff = await invokeHttp(env, { headers: staff.headers, organizationId: owner.organizationId }, () =>
      postOrganizations(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/organizations",
          {
            slug: "second-org",
            name: "Second Org",
            defaultCurrency: "SYP",
            timezone: "Asia/Damascus",
            locale: "ar",
          },
          { cookie: staff.headers },
        ),
      ),
    );
    const staffResult = await readJson(asStaff);
    expect(staffResult.status).toBe(409);
    expect((staffResult.body.error as { code: string }).code).toBe("CONFLICT");

    const asOwner = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      postOrganizations(
        jsonRequest(
          "POST",
          "http://localhost:3000/api/organizations",
          {
            slug: "owner-second",
            name: "Owner Second",
            defaultCurrency: "SYP",
            timezone: "Asia/Damascus",
            locale: "ar",
          },
          { cookie: owner.headers },
        ),
      ),
    );
    expect((await readJson(asOwner)).status).toBe(409);
  });
});
