import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/ui/guided-setup/route";
import { GUIDED_SETUP_DONE_COOKIE } from "@/modules/onboarding/presentation";
import { createTestEnvironment, invokeHttp, seedOwnerWithOrganization } from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

function jsonRequest(url: string, body: unknown, extra?: Headers): Request {
  const headers = extra ? new Headers(extra) : new Headers();
  headers.set("content-type", "application/json");
  headers.set("origin", "http://localhost:3000");
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

function cookiesOf(response: Response): string {
  const anyHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie().join("; ");
  }
  return response.headers.get("set-cookie") ?? "";
}

describe("guided setup completion HTTP (BUG-008)", () => {
  it("rejects unauthenticated completion", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      POST(jsonRequest("http://localhost:3000/api/ui/guided-setup", { action: "complete" })),
    );
    expect((await readJson(response)).status).toBe(401);
  });

  it("does not mark Guided Setup complete before the center is operationally ready", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@setup-early.com",
      name: "Owner Early",
      slug: "setup-early",
    });
    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => POST(jsonRequest("http://localhost:3000/api/ui/guided-setup", { action: "complete" }, owner.headers)),
    );
    const { status } = await readJson(response);
    expect(status).toBe(409);
    expect(cookiesOf(response)).not.toMatch(new RegExp(`${GUIDED_SETUP_DONE_COOKIE}=`));
  });

  it("records Finish in the presentation cookie once operationally ready", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@setup-done.com",
      name: "Owner Done",
      slug: "setup-done",
    });
    await seedPlayableDevice(env, owner);
    const response = await invokeHttp(
      env,
      { headers: owner.headers, organizationId: owner.organizationId },
      () => POST(jsonRequest("http://localhost:3000/api/ui/guided-setup", { action: "complete" }, owner.headers)),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      data: { completed: true, organizationId: owner.organizationId, operationallyReady: true },
    });
    const cookie = cookiesOf(response);
    expect(cookie).toContain(`${GUIDED_SETUP_DONE_COOKIE}=`);
    expect(cookie).toContain(owner.organizationId);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toMatch(/samesite=lax/);
  });
});
