import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redirect } from "next/navigation";
import { RedirectStatusCode } from "next/dist/client/components/redirect-status-code";
import { POST as postAuth } from "@/app/api/auth/[...all]/route";
import SetupPage from "@/app/setup/page";
import {
  BETTER_AUTH_EMAIL_SIGN_UP_PATH,
  SETUP_CLOSED_REDIRECT,
  SETUP_FORM_NATIVE_ACTION,
  SETUP_FORM_NATIVE_METHOD,
  SETUP_PAGE_REDIRECT_STATUS,
  httpRedirectPreservesRequest,
  parseNextRedirectDigest,
  requestAfterHttpRedirect,
  urlContainsSetupSecrets,
} from "@/auth/setup-form-safety";
import { FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER } from "@/core/env";
import { coreUsers } from "@/db/schema";
import { createTestEnvironment, invokeHttp, seedOwnerWithOrganization } from "../helpers/identity";
import {
  LOGIN_FORM_NATIVE_ACTION,
  LOGIN_FORM_NATIVE_METHOD,
  urlContainsAuthCredentials,
} from "@/auth/login-form-safety";

const root = resolve(__dirname, "../../src");
const PASSWORD_MARKER = "pw-bug029-must-not-reach-login";
const TOKEN_MARKER = "tok-bug029-must-not-reach-login";
const EMAIL_MARKER = "qa-bug029@example.test";
const NAME_MARKER = "QA Bug029 Name";
const FORM_BODY = `name=${encodeURIComponent(NAME_MARKER)}&email=${encodeURIComponent(EMAIL_MARKER)}&password=${encodeURIComponent(PASSWORD_MARKER)}&bootstrapToken=${encodeURIComponent(TOKEN_MARKER)}`;

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

async function setupPageRedirect(
  env: Awaited<ReturnType<typeof createTestEnvironment>>,
  searchParams: Record<string, string | string[] | undefined>,
) {
  return invokeHttp(env, { headers: new Headers() }, async () => {
    try {
      await SetupPage({ searchParams: Promise.resolve(searchParams) });
      return { redirected: null as { url: string; status: number } | null, rendered: true };
    } catch (error) {
      const redirected = parseNextRedirectDigest(error);
      if (redirected) return { redirected, rendered: false };
      if (error instanceof ReferenceError && String(error.message).includes("React")) {
        return { redirected: null, rendered: true };
      }
      throw error;
    }
  });
}

describe("BUG-029 closed-bootstrap POST /setup must not replay the body", () => {
  it("uses Next.js See Other, not Temporary/Permanent redirect", () => {
    expect(SETUP_PAGE_REDIRECT_STATUS).toBe(RedirectStatusCode.SeeOther);
    expect(SETUP_PAGE_REDIRECT_STATUS).not.toBe(RedirectStatusCode.TemporaryRedirect);
    expect(SETUP_PAGE_REDIRECT_STATUS).not.toBe(RedirectStatusCode.PermanentRedirect);
    expect(httpRedirectPreservesRequest(RedirectStatusCode.TemporaryRedirect)).toBe(true);
    expect(httpRedirectPreservesRequest(RedirectStatusCode.PermanentRedirect)).toBe(true);
    expect(httpRedirectPreservesRequest(RedirectStatusCode.SeeOther)).toBe(false);
  });

  it("documents that next/navigation redirect() is 307 and would preserve a POST body", () => {
    try {
      redirect("/login");
      throw new Error("redirect() must throw");
    } catch (error) {
      const parsed = parseNextRedirectDigest(error);
      expect(parsed).toEqual({ url: "/login", status: RedirectStatusCode.TemporaryRedirect });
      const followed = requestAfterHttpRedirect({
        method: "POST",
        body: FORM_BODY,
        location: parsed!.url,
        status: parsed!.status,
      });
      expect(followed.method).toBe("POST");
      expect(followed.body).toContain(PASSWORD_MARKER);
      expect(followed.body).toContain(TOKEN_MARKER);
    }
  });

  it("closed-bootstrap /setup throws 303 to /login so the follow is GET without the body", async () => {
    const env = await createTestEnvironment();
    await seedOwnerWithOrganization(env, {
      email: "owner@example.com",
      name: "Owner",
      slug: "bug029-closed",
    });
    const usersBefore = await env.db.select({ email: coreUsers.email }).from(coreUsers);
    const outcome = await setupPageRedirect(env, {});
    expect(outcome.rendered).toBe(false);
    expect(outcome.redirected).not.toBeNull();
    expect(outcome.redirected!.url).toBe(SETUP_CLOSED_REDIRECT);
    expect(outcome.redirected!.url).toBe("/login");
    expect(outcome.redirected!.status).toBe(SETUP_PAGE_REDIRECT_STATUS);
    expect(outcome.redirected!.status).toBe(RedirectStatusCode.SeeOther);
    expect(httpRedirectPreservesRequest(outcome.redirected!.status)).toBe(false);
    expect([307, 308]).not.toContain(outcome.redirected!.status);

    const followed = requestAfterHttpRedirect({
      method: "POST",
      body: FORM_BODY,
      location: outcome.redirected!.url,
      status: outcome.redirected!.status,
    });
    expect(followed.method).toBe("GET");
    expect(followed.url).toBe("/login");
    expect(followed.body).toBeNull();
    expect(JSON.stringify(followed)).not.toContain(PASSWORD_MARKER);
    expect(JSON.stringify(followed)).not.toContain(TOKEN_MARKER);
    expect(
      urlContainsSetupSecrets(`http://localhost:3000${followed.url}`, {
        password: PASSWORD_MARKER,
        bootstrapToken: TOKEN_MARKER,
        email: EMAIL_MARKER,
      }),
    ).toBe(false);

    const loginSource = source("app/login/page.tsx");
    expect(loginSource).not.toMatch(/formData/);
    expect(loginSource).not.toMatch(/request\.body/);
    expect(loginSource).toContain("searchParams");

    const usersAfter = await env.db.select({ email: coreUsers.email }).from(coreUsers);
    expect(usersAfter.map((row) => row.email)).toEqual(usersBefore.map((row) => row.email));
    expect(usersAfter.map((row) => row.email)).toEqual(["owner@example.com"]);
  });

  it("open setup still fail-closes on native POST: no redirect, no owner created", async () => {
    const env = await createTestEnvironment();
    const outcome = await setupPageRedirect(env, {});
    expect(outcome.rendered).toBe(true);
    expect(outcome.redirected).toBeNull();
    const users = await env.db.select({ id: coreUsers.id }).from(coreUsers);
    expect(users).toHaveLength(0);
    expect(source("app/setup/page.tsx")).toContain("return <SetupForm />");
    expect(source("app/setup/page.tsx")).not.toMatch(/formData/);
    expect(source("app/setup/page.tsx")).not.toMatch(/signUp/i);
  });

  it("setup page wiring never uses default redirect() 307/308 for navigation", () => {
    const page = source("app/setup/page.tsx");
    const helper = source("auth/setup-page-redirect.ts");
    expect(page).toContain("redirectDiscardingRequestBody(destination)");
    expect(page).not.toMatch(/from ["']next\/navigation["']/);
    expect(helper).toContain("throw getRedirectError(url, RedirectType.replace, RedirectStatusCode.SeeOther)");
    expect(helper).not.toContain("RedirectStatusCode.TemporaryRedirect");
    expect(helper).not.toContain("RedirectStatusCode.PermanentRedirect");
    expect(SETUP_FORM_NATIVE_METHOD.toLowerCase()).toBe("post");
    expect(SETUP_FORM_NATIVE_ACTION).toBe("/setup");
  });
});

describe("BUG-028 no-GET protection remains in place", () => {
  it("setup form still declares POST /setup and never GET", () => {
    const form = source("app/setup/setup-form.tsx");
    expect(form).toContain("method={SETUP_FORM_NATIVE_METHOD}");
    expect(form).toContain("action={SETUP_FORM_NATIVE_ACTION}");
    expect(form).toContain("formMethod={SETUP_FORM_NATIVE_METHOD}");
    expect(form).toContain("event.preventDefault()");
    expect(form).not.toMatch(/method=["']get["']/i);
    expect(SETUP_FORM_NATIVE_METHOD.toLowerCase()).not.toBe("get");
  });
});

describe("BUG-027 login no-JS protection remains in place", () => {
  it("login form still declares POST /login and never GET", () => {
    const form = source("app/login/login-form.tsx");
    expect(form).toContain("method={LOGIN_FORM_NATIVE_METHOD}");
    expect(form).toContain("action={LOGIN_FORM_NATIVE_ACTION}");
    expect(LOGIN_FORM_NATIVE_METHOD.toLowerCase()).toBe("post");
    expect(LOGIN_FORM_NATIVE_ACTION).toBe("/login");
    expect(urlContainsAuthCredentials("http://localhost:3000/login", { password: PASSWORD_MARKER })).toBe(
      false,
    );
  });
});

describe("BUG-029 public signup remains fail-closed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("JSON signup without a bootstrap token is 403 and creates no user", async () => {
    const env = await createTestEnvironment();
    const requestUrl = `http://localhost:3000${BETTER_AUTH_EMAIL_SIGN_UP_PATH}`;
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(requestUrl, {
          email: EMAIL_MARKER,
          password: PASSWORD_MARKER,
          name: NAME_MARKER,
        }),
      ),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("FORBIDDEN");
    expect(urlContainsSetupSecrets(requestUrl, { password: PASSWORD_MARKER, bootstrapToken: TOKEN_MARKER })).toBe(
      false,
    );
    const users = await env.db.select({ id: coreUsers.id }).from(coreUsers);
    expect(users).toHaveLength(0);
    expect(FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER.toLowerCase()).toBe("x-gaming-bootstrap-token");
  });
});
