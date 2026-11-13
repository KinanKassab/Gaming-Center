import { describe, expect, it } from "vitest";
import {
  BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD,
  BETTER_AUTH_EMAIL_SIGN_IN_PATH,
  LOGIN_CREDENTIAL_FIELD_NAMES,
  LOGIN_FORM_NATIVE_ACTION,
  LOGIN_FORM_NATIVE_METHOD,
  credentialQueryKeysPresent,
  htmlFormMethodIsGet,
  loginCredentialQueryRedirect,
  nativeFormNavigationUrl,
  urlContainsAuthCredentials,
} from "@/auth/login-form-safety";

const LOGIN_DOCUMENT = "http://localhost:3000/login";
const EMAIL = "qa-owner@example.test";
/** Distinctive marker — tests assert this never appears in a URL. */
const PASSWORD_MARKER = "pw-bug027-must-not-appear-in-url";
const FIELDS = { email: EMAIL, password: PASSWORD_MARKER };

describe("BUG-027 login native form safety", () => {
  it("does not treat login as a GET form", () => {
    expect(htmlFormMethodIsGet(undefined)).toBe(true);
    expect(htmlFormMethodIsGet("")).toBe(true);
    expect(htmlFormMethodIsGet("GET")).toBe(true);
    expect(htmlFormMethodIsGet("get")).toBe(true);
    expect(htmlFormMethodIsGet(LOGIN_FORM_NATIVE_METHOD)).toBe(false);
    expect(LOGIN_FORM_NATIVE_METHOD.toLowerCase()).toBe("post");
    expect(LOGIN_FORM_NATIVE_ACTION).toBe("/login");
    expect(LOGIN_FORM_NATIVE_ACTION).not.toMatch(/[?#]/);
    expect(LOGIN_CREDENTIAL_FIELD_NAMES).toEqual(["email", "password"]);
  });

  it("reproduces the unsafe HTML default: missing method GET-encodes credentials", () => {
    const leaked = nativeFormNavigationUrl({
      documentUrl: LOGIN_DOCUMENT,
      action: "",
      method: undefined,
      fields: FIELDS,
    });
    expect(htmlFormMethodIsGet(undefined)).toBe(true);
    expect(urlContainsAuthCredentials(leaked, FIELDS)).toBe(true);
    expect(leaked).toContain(PASSWORD_MARKER);
    expect(leaked).toContain("email=");
    expect(leaked).toContain("password=");
  });

  it("keeps email and password out of the URL on native POST to /login", () => {
    const url = nativeFormNavigationUrl({
      documentUrl: LOGIN_DOCUMENT,
      action: LOGIN_FORM_NATIVE_ACTION,
      method: LOGIN_FORM_NATIVE_METHOD,
      fields: FIELDS,
    });
    expect(url).toBe(LOGIN_DOCUMENT);
    expect(urlContainsAuthCredentials(url, FIELDS)).toBe(false);
    expect(url).not.toContain(PASSWORD_MARKER);
    expect(url).not.toContain("password=");
    expect(url).not.toMatch(/[?&]email=/);
  });

  it("does not encode credentials into fragments or search on the native action", () => {
    const url = nativeFormNavigationUrl({
      documentUrl: "http://localhost:3000/login?next=%2Fadmin",
      action: LOGIN_FORM_NATIVE_ACTION,
      method: LOGIN_FORM_NATIVE_METHOD,
      fields: FIELDS,
    });
    expect(url).toBe(LOGIN_DOCUMENT);
    expect(urlContainsAuthCredentials(url, FIELDS)).toBe(false);
  });

  it("strips credential query keys with a static /login redirect and never copies values", () => {
    expect(credentialQueryKeysPresent({ branchId: "x" })).toBe(false);
    expect(loginCredentialQueryRedirect({ branchId: "x" })).toBeNull();
    expect(
      loginCredentialQueryRedirect({
        email: EMAIL,
        password: PASSWORD_MARKER,
      }),
    ).toBe("/login");
    expect(loginCredentialQueryRedirect({ Password: PASSWORD_MARKER })).toBe("/login");
    const redirectTo = loginCredentialQueryRedirect({
      email: EMAIL,
      password: PASSWORD_MARKER,
    });
    expect(redirectTo).not.toContain(PASSWORD_MARKER);
    expect(redirectTo).not.toContain("@");
    expect(urlContainsAuthCredentials(`http://localhost:3000${redirectTo}`, FIELDS)).toBe(false);
  });

  it("keeps the hydrated Better Auth path as JSON POST, not a query URL", () => {
    expect(BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD).toBe("POST");
    expect(BETTER_AUTH_EMAIL_SIGN_IN_PATH).toBe("/api/auth/sign-in/email");
    expect(BETTER_AUTH_EMAIL_SIGN_IN_PATH).not.toMatch(/[?#]/);
    const signInUrl = new URL(BETTER_AUTH_EMAIL_SIGN_IN_PATH, "http://localhost:3000");
    expect(urlContainsAuthCredentials(signInUrl.href, FIELDS)).toBe(false);
  });
});
