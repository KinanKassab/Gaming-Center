import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { POST as postAuth } from "@/app/api/auth/[...all]/route";
import {
  BETTER_AUTH_EMAIL_SIGN_IN_PATH,
  LOGIN_FORM_NATIVE_ACTION,
  LOGIN_FORM_NATIVE_METHOD,
  urlContainsAuthCredentials,
} from "@/auth/login-form-safety";
import { createTestEnvironment, invokeHttp, signUp } from "../helpers/identity";

const root = resolve(__dirname, "../../src");

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

describe("BUG-027 login form wiring", () => {
  it("declares an explicit POST native form and never defaults to GET", () => {
    const form = source("app/login/login-form.tsx");
    expect(form).toContain("method={LOGIN_FORM_NATIVE_METHOD}");
    expect(form).toContain("action={LOGIN_FORM_NATIVE_ACTION}");
    expect(form).toContain("formMethod={LOGIN_FORM_NATIVE_METHOD}");
    expect(form).toContain("formAction={LOGIN_FORM_NATIVE_ACTION}");
    expect(form).toContain("javascriptRequired");
    expect(form).not.toMatch(/method=["']get["']/i);
    expect(form).not.toMatch(/formMethod=["']get["']/i);
    expect(LOGIN_FORM_NATIVE_METHOD.toLowerCase()).not.toBe("get");
    expect(LOGIN_FORM_NATIVE_ACTION).toBe("/login");

    const page = source("app/login/page.tsx");
    expect(page).toContain("loginCredentialQueryRedirect");
    expect(page).toContain("HardRedirect");
    expect(page).not.toContain('from "next/navigation"');
    expect(page).not.toContain("router.push(`/login?");
    expect(source("auth/entry.ts")).not.toContain('from "next/navigation"');
    expect(source("app/page.tsx")).toContain("authenticatedEntryHref");
  });

  it("hydrated submit still uses Better Auth JSON POST, not a credential URL", () => {
    const form = source("app/login/login-form.tsx");
    expect(form).toContain("BETTER_AUTH_EMAIL_SIGN_IN_PATH");
    expect(form).toContain("BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD");
    expect(form).toContain("event.preventDefault()");
    expect(form).not.toContain("router.push(`/login?");
    expect(form).not.toContain("router.push('/login?'");
    expect(BETTER_AUTH_EMAIL_SIGN_IN_PATH).toBe("/api/auth/sign-in/email");
  });
});

describe("BUG-027 Better Auth email sign-in (hydrated path)", () => {
  it("signs in with JSON POST and does not put credentials in the request URL", async () => {
    const env = await createTestEnvironment();
    await signUp(env.auth, {
      email: "owner@example.com",
      password: "password-123",
      name: "Owner",
    });
    const requestUrl = `http://localhost:3000${BETTER_AUTH_EMAIL_SIGN_IN_PATH}`;
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(requestUrl, {
          email: "owner@example.com",
          password: "password-123",
        }),
      ),
    );
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(urlContainsAuthCredentials(requestUrl, { password: "password-123" })).toBe(false);
    const setCookie = response.headers.getSetCookie?.() ?? [];
    expect(setCookie.some((cookie) => cookie.toLowerCase().includes("session"))).toBe(true);
  });

  it("rejects invalid credentials on JSON POST without encoding them in a URL", async () => {
    const env = await createTestEnvironment();
    await signUp(env.auth, {
      email: "owner@example.com",
      password: "password-123",
      name: "Owner",
    });
    const requestUrl = `http://localhost:3000${BETTER_AUTH_EMAIL_SIGN_IN_PATH}`;
    const wrongPassword = "wrong-password-bug027";
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(requestUrl, {
          email: "owner@example.com",
          password: wrongPassword,
        }),
      ),
    );
    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(urlContainsAuthCredentials(requestUrl, { password: wrongPassword })).toBe(false);
    expect(urlContainsAuthCredentials(response.url || requestUrl, { password: wrongPassword })).toBe(
      false,
    );
  });
});
