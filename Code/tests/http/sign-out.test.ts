import { describe, expect, it } from "vitest";
import { AuthenticationError } from "@/core/errors";
import { GET as getMe } from "@/app/api/me/route";
import { POST as postSignOut } from "@/app/api/auth/[...all]/route";
import { ORGANIZATION_COOKIE } from "@/app/api/_lib/handler";
import { authenticateRequest } from "@/auth/context";
import {
  BETTER_AUTH_SIGN_OUT_PATH,
  betterAuthSignOutInit,
  isSuccessfulSignOutResponse,
} from "@/auth/sign-out-http";
import {
  createTestEnvironment,
  invokeHttp,
  seedOwnerWithOrganization,
} from "../helpers/identity";

function organizationCookieCleared(response: Response): boolean {
  const setCookie = response.headers.getSetCookie?.() ?? [];
  return setCookie.some(
    (cookie) => cookie.startsWith(`${ORGANIZATION_COOKIE}=`) && /Max-Age=0/i.test(cookie),
  );
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

describe("Better Auth sign-out contract", () => {
  it("sends the JSON content type Better Auth 1.7 requires", () => {
    const init = betterAuthSignOutInit();
    const headers = new Headers(init.headers);
    expect(BETTER_AUTH_SIGN_OUT_PATH).toBe("/api/auth/sign-out");
    expect(init.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe("{}");
    expect(isSuccessfulSignOutResponse(new Response(JSON.stringify({ success: true }), { status: 200 }))).toBe(
      true,
    );
    expect(isSuccessfulSignOutResponse(new Response(null, { status: 415 }))).toBe(false);
    expect(isSuccessfulSignOutResponse(new Response(null, { status: 500 }))).toBe(false);
  });
});

describe("HTTP sign-out", () => {
  it("rejects a non-canonical sign-out and does not treat failure as success", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "signout-415",
    });
    const request = new Request("http://localhost:3000/api/auth/sign-out", {
      method: "POST",
      headers: owner.headers,
      body: "",
    });
    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => postSignOut(request),
    );
    expect(response.ok).toBe(false);
    expect(response.status).toBe(415);
    expect(isSuccessfulSignOutResponse(response)).toBe(false);
    expect(organizationCookieCleared(response)).toBe(false);
    const stillSignedIn = await authenticateRequest(env.db, env.auth, owner.headers);
    expect(stillSignedIn.user.email).toBe("owner@a.com");
  });

  it("invalidates the Better Auth session and leaves the caller unauthenticated", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "signout-ok",
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
    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(isSuccessfulSignOutResponse(response)).toBe(true);
    expect(organizationCookieCleared(response)).toBe(true);

    await expect(authenticateRequest(env.db, env.auth, owner.headers)).rejects.toThrow(AuthenticationError);

    const me = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => getMe(),
    );
    expect((await readJson(me)).status).toBe(401);
  });
});
