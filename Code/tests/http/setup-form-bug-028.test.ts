import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { POST as postAuth } from "@/app/api/auth/[...all]/route";
import { GET as getSetupStatus } from "@/app/api/setup/status/route";
import SetupPage from "@/app/setup/page";
import {
  BETTER_AUTH_EMAIL_SIGN_UP_PATH,
  SETUP_BOOTSTRAP_TOKEN_HEADER,
  SETUP_CLOSED_REDIRECT,
  SETUP_FORM_NATIVE_ACTION,
  SETUP_FORM_NATIVE_METHOD,
  urlContainsSetupSecrets,
} from "@/auth/setup-form-safety";
import { FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER } from "@/core/env";
import { coreUsers } from "@/db/schema";
import {
  createTestEnvironment,
  invokeHttp,
  seedOwnerWithOrganization,
} from "../helpers/identity";
import {
  LOGIN_FORM_NATIVE_ACTION,
  LOGIN_FORM_NATIVE_METHOD,
  urlContainsAuthCredentials,
} from "@/auth/login-form-safety";

const root = resolve(__dirname, "../../src");
const BOOTSTRAP_TOKEN = "test-bootstrap-token";
const PASSWORD_MARKER = "pw-bug028-must-not-appear-in-url";
const TOKEN_MARKER = "tok-bug028-must-not-appear";

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

function jsonRequest(
  url: string,
  body: unknown,
  extra?: { token?: string },
): Request {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("origin", "http://localhost:3000");
  if (extra?.token) headers.set(FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER, extra.token);
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

function thrownRedirectUrl(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const digest = String((error as { digest?: unknown }).digest ?? "");
  if (!digest.startsWith("NEXT_REDIRECT;")) return null;
  return digest.split(";").slice(2, -2).join(";");
}

async function setupPageOutcome(
  env: Awaited<ReturnType<typeof createTestEnvironment>>,
  searchParams: Record<string, string | string[] | undefined>,
) {
  return invokeHttp(env, { headers: new Headers() }, async () => {
    try {
      const element = await SetupPage({ searchParams: Promise.resolve(searchParams) });
      return { redirectedTo: null as string | null, rendered: Boolean(element) };
    } catch (error) {
      const redirectedTo = thrownRedirectUrl(error);
      if (!redirectedTo) throw error;
      return { redirectedTo, rendered: false };
    }
  });
}

describe("BUG-028 setup form wiring", () => {
  it("declares an explicit POST native form and never defaults to GET", () => {
    const form = source("app/setup/setup-form.tsx");
    expect(form).toContain("method={SETUP_FORM_NATIVE_METHOD}");
    expect(form).toContain("action={SETUP_FORM_NATIVE_ACTION}");
    expect(form).toContain("formMethod={SETUP_FORM_NATIVE_METHOD}");
    expect(form).toContain("formAction={SETUP_FORM_NATIVE_ACTION}");
    expect(form).toContain("javascriptRequired");
    expect(form).toContain("event.preventDefault()");
    expect(form).not.toMatch(/method=["']get["']/i);
    expect(form).not.toMatch(/formMethod=["']get["']/i);
    expect(SETUP_FORM_NATIVE_METHOD.toLowerCase()).not.toBe("get");
    expect(SETUP_FORM_NATIVE_ACTION).toBe("/setup");

    const page = source("app/setup/page.tsx");
    expect(page).toContain("resolveSetupPageNavigation");
    expect(page).toContain("redirectDiscardingRequestBody(destination)");
    expect(page).not.toMatch(/\bredirect\(destination\)/);
    expect(page).not.toContain("router.push(`/setup?");
    expect(page).not.toMatch(/formData/);
    expect(page).not.toMatch(/signUp/i);
  });

  it("hydrated submit still uses Better Auth JSON POST with the bootstrap header, not a secret URL", () => {
    const form = source("app/setup/setup-form.tsx");
    expect(form).toContain("BETTER_AUTH_EMAIL_SIGN_UP_PATH");
    expect(form).toContain("BETTER_AUTH_EMAIL_SIGN_IN_PATH");
    expect(form).toContain("SETUP_BOOTSTRAP_TOKEN_HEADER");
    expect(form).toContain("event.preventDefault()");
    expect(form).not.toContain("router.push(`/setup?");
    expect(form).not.toContain("router.push('/setup?'");
    expect(BETTER_AUTH_EMAIL_SIGN_UP_PATH).toBe("/api/auth/sign-up/email");
    expect(SETUP_BOOTSTRAP_TOKEN_HEADER).toBe("x-gaming-bootstrap-token");
  });
});

describe("BUG-028 existing-owner /setup gating", () => {
  it("keeps /setup open only while no owner exists, without creating a user", async () => {
    const env = await createTestEnvironment();
    const openStatus = await invokeHttp(env, { headers: new Headers() }, () => getSetupStatus());
    expect(
      ((await readJson(openStatus)).body.data as { firstUserRequired: boolean }).firstUserRequired,
    ).toBe(true);
    const usersBefore = await env.db.select({ id: coreUsers.id }).from(coreUsers);
    expect(usersBefore).toHaveLength(0);
    expect(source("app/setup/page.tsx")).toContain("return <SetupForm />");
  });

  it("redirects /setup to /login once an owner exists and does not create another", async () => {
    const env = await createTestEnvironment();
    await seedOwnerWithOrganization(env, {
      email: "owner@example.com",
      name: "Owner",
      slug: "closed-setup",
    });
    const closedStatus = await invokeHttp(env, { headers: new Headers() }, () => getSetupStatus());
    expect(
      ((await readJson(closedStatus)).body.data as { firstUserRequired: boolean }).firstUserRequired,
    ).toBe(false);
    const closedPage = await setupPageOutcome(env, {});
    expect(closedPage.redirectedTo).toBe(SETUP_CLOSED_REDIRECT);
    expect(closedPage.redirectedTo).toBe("/login");
    const users = await env.db.select({ email: coreUsers.email }).from(coreUsers);
    expect(users.map((row) => row.email)).toEqual(["owner@example.com"]);
  });

  it("strips leaked setup query keys without copying values, even when bootstrap is closed", async () => {
    const env = await createTestEnvironment();
    await seedOwnerWithOrganization(env, {
      email: "owner@example.com",
      name: "Owner",
      slug: "leaked-query",
    });
    const outcome = await setupPageOutcome(env, {
      email: "qa-bug028@example.test",
      password: PASSWORD_MARKER,
      bootstrapToken: TOKEN_MARKER,
      name: "QA Bug028 Name",
    });
    expect(outcome.redirectedTo).toBe("/setup");
    expect(outcome.redirectedTo).not.toContain(PASSWORD_MARKER);
    expect(outcome.redirectedTo).not.toContain(TOKEN_MARKER);
    expect(urlContainsSetupSecrets(`http://localhost:3000${outcome.redirectedTo}`, {
      password: PASSWORD_MARKER,
      bootstrapToken: TOKEN_MARKER,
    })).toBe(false);
    const users = await env.db.select({ email: coreUsers.email }).from(coreUsers);
    expect(users.map((row) => row.email)).toEqual(["owner@example.com"]);
  });
});

describe("BUG-028 Better Auth hydrated bootstrap path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the first owner with JSON POST and does not put secrets in the request URL", async () => {
    vi.stubEnv("GAMING_FIRST_ADMIN_BOOTSTRAP_TOKEN", BOOTSTRAP_TOKEN);
    const env = await createTestEnvironment();
    const requestUrl = `http://localhost:3000${BETTER_AUTH_EMAIL_SIGN_UP_PATH}`;
    const password = "password-123";
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(
          requestUrl,
          { email: "owner@example.com", password, name: "Owner" },
          { token: BOOTSTRAP_TOKEN },
        ),
      ),
    );
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(urlContainsSetupSecrets(requestUrl, { password, bootstrapToken: BOOTSTRAP_TOKEN })).toBe(
      false,
    );
    const users = await env.db.select({ email: coreUsers.email }).from(coreUsers);
    expect(users.map((row) => row.email)).toEqual(["owner@example.com"]);
  });

  it("keeps public signup fail-closed without a bootstrap token", async () => {
    const env = await createTestEnvironment();
    const requestUrl = `http://localhost:3000${BETTER_AUTH_EMAIL_SIGN_UP_PATH}`;
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(requestUrl, {
          email: "owner@example.com",
          password: PASSWORD_MARKER,
          name: "Owner",
        }),
      ),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("FORBIDDEN");
    expect(urlContainsSetupSecrets(requestUrl, { password: PASSWORD_MARKER })).toBe(false);
    const users = await env.db.select({ id: coreUsers.id }).from(coreUsers);
    expect(users).toHaveLength(0);
  });
});

describe("BUG-027 login no-JS protection remains in place", () => {
  it("login form still declares POST /login and never GET", () => {
    const form = source("app/login/login-form.tsx");
    expect(form).toContain("method={LOGIN_FORM_NATIVE_METHOD}");
    expect(form).toContain("action={LOGIN_FORM_NATIVE_ACTION}");
    expect(LOGIN_FORM_NATIVE_METHOD.toLowerCase()).toBe("post");
    expect(LOGIN_FORM_NATIVE_ACTION).toBe("/login");
    expect(urlContainsAuthCredentials("http://localhost:3000/login", { password: "x" })).toBe(false);
  });
});
