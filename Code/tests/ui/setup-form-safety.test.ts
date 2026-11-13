import { describe, expect, it } from "vitest";
import {
  BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD,
  BETTER_AUTH_EMAIL_SIGN_IN_PATH,
  BETTER_AUTH_EMAIL_SIGN_UP_HTTP_METHOD,
  BETTER_AUTH_EMAIL_SIGN_UP_PATH,
  SETUP_BOOTSTRAP_TOKEN_HEADER,
  SETUP_CLOSED_REDIRECT,
  SETUP_FORM_NATIVE_ACTION,
  SETUP_FORM_NATIVE_METHOD,
  SETUP_PAGE_REDIRECT_STATUS,
  SETUP_SENSITIVE_FIELD_NAMES,
  htmlFormMethodIsGet,
  httpRedirectPreservesRequest,
  nativeFormNavigationUrl,
  parseNextRedirectDigest,
  requestAfterHttpRedirect,
  resolveSetupPageNavigation,
  setupSensitiveQueryRedirect,
  urlContainsSetupSecrets,
} from "@/auth/setup-form-safety";

const SETUP_DOCUMENT = "http://localhost:3000/setup";
const EMAIL = "qa-bug028@example.test";
const PASSWORD_MARKER = "pw-bug028-must-not-appear-in-url";
const TOKEN_MARKER = "tok-bug028-must-not-appear";
const NAME_MARKER = "QA Bug028 Name";
const FIELDS = {
  name: NAME_MARKER,
  email: EMAIL,
  password: PASSWORD_MARKER,
  bootstrapToken: TOKEN_MARKER,
};

describe("BUG-028 setup native form safety", () => {
  it("does not treat setup as a GET form", () => {
    expect(htmlFormMethodIsGet(undefined)).toBe(true);
    expect(htmlFormMethodIsGet("")).toBe(true);
    expect(htmlFormMethodIsGet("GET")).toBe(true);
    expect(htmlFormMethodIsGet(SETUP_FORM_NATIVE_METHOD)).toBe(false);
    expect(SETUP_FORM_NATIVE_METHOD.toLowerCase()).toBe("post");
    expect(SETUP_FORM_NATIVE_ACTION).toBe("/setup");
    expect(SETUP_FORM_NATIVE_ACTION).not.toMatch(/[?#]/);
    expect(SETUP_CLOSED_REDIRECT).toBe("/login");
    expect(SETUP_SENSITIVE_FIELD_NAMES).toEqual(["name", "email", "password", "bootstrapToken"]);
  });

  it("reproduces the unsafe HTML default: missing method GET-encodes setup secrets", () => {
    const leaked = nativeFormNavigationUrl({
      documentUrl: SETUP_DOCUMENT,
      action: "",
      method: undefined,
      fields: FIELDS,
    });
    expect(htmlFormMethodIsGet(undefined)).toBe(true);
    expect(urlContainsSetupSecrets(leaked, FIELDS)).toBe(true);
    expect(leaked).toContain(PASSWORD_MARKER);
    expect(leaked).toContain(TOKEN_MARKER);
    expect(leaked).toMatch(/[?&]email=/);
    expect(leaked).toMatch(/[?&]password=/);
    expect(leaked).toMatch(/[?&]bootstrapToken=/);
  });

  it("keeps setup fields out of the URL on native POST to /setup", () => {
    const url = nativeFormNavigationUrl({
      documentUrl: SETUP_DOCUMENT,
      action: SETUP_FORM_NATIVE_ACTION,
      method: SETUP_FORM_NATIVE_METHOD,
      fields: FIELDS,
    });
    expect(url).toBe(SETUP_DOCUMENT);
    expect(urlContainsSetupSecrets(url, FIELDS)).toBe(false);
    expect(url).not.toContain(PASSWORD_MARKER);
    expect(url).not.toContain(TOKEN_MARKER);
    expect(url).not.toContain("password=");
    expect(url).not.toMatch(/[?&]bootstrapToken=/);
    expect(url).not.toMatch(/[?&]email=/);
  });

  it("does not encode setup secrets into fragments or search on the native action", () => {
    const url = nativeFormNavigationUrl({
      documentUrl: "http://localhost:3000/setup?next=%2Fadmin",
      action: SETUP_FORM_NATIVE_ACTION,
      method: SETUP_FORM_NATIVE_METHOD,
      fields: FIELDS,
    });
    expect(url).toBe(SETUP_DOCUMENT);
    expect(urlContainsSetupSecrets(url, FIELDS)).toBe(false);
  });

  it("strips sensitive query keys with a static /setup redirect and never copies values", () => {
    expect(setupSensitiveQueryRedirect({ branchId: "x" })).toBeNull();
    const redirectTo = setupSensitiveQueryRedirect({
      email: EMAIL,
      password: PASSWORD_MARKER,
      bootstrapToken: TOKEN_MARKER,
      name: NAME_MARKER,
    });
    expect(redirectTo).toBe("/setup");
    expect(redirectTo).not.toContain(PASSWORD_MARKER);
    expect(redirectTo).not.toContain(TOKEN_MARKER);
    expect(redirectTo).not.toContain("@");
    expect(urlContainsSetupSecrets(`http://localhost:3000${redirectTo}`, FIELDS)).toBe(false);
    expect(setupSensitiveQueryRedirect({ Password: PASSWORD_MARKER })).toBe("/setup");
    expect(setupSensitiveQueryRedirect({ BootstrapToken: TOKEN_MARKER })).toBe("/setup");
  });

  it("strips leaked query before existing-owner /login so secrets are not in that hop", () => {
    expect(
      resolveSetupPageNavigation({
        firstUserRequired: false,
        searchParams: {},
      }),
    ).toBe("/login");
    expect(
      resolveSetupPageNavigation({
        firstUserRequired: true,
        searchParams: {},
      }),
    ).toBeNull();
    const stripFirst = resolveSetupPageNavigation({
      firstUserRequired: false,
      searchParams: { password: PASSWORD_MARKER, bootstrapToken: TOKEN_MARKER },
    });
    expect(stripFirst).toBe("/setup");
    expect(stripFirst).not.toContain(PASSWORD_MARKER);
    expect(stripFirst).not.toContain(TOKEN_MARKER);
    expect(
      resolveSetupPageNavigation({
        firstUserRequired: true,
        searchParams: { email: EMAIL },
      }),
    ).toBe("/setup");
  });

  it("treats 307/308 as body-preserving and 303 as GET without a body", () => {
    const formBody =
      "name=QA+Bug029+Name&email=qa-bug029%40example.test&password=pw-bug029-must-not-reach-login&bootstrapToken=tok-bug029-must-not-reach-login";
    const preserved = requestAfterHttpRedirect({
      method: "POST",
      body: formBody,
      location: "/login",
      status: 307,
    });
    expect(httpRedirectPreservesRequest(307)).toBe(true);
    expect(httpRedirectPreservesRequest(308)).toBe(true);
    expect(httpRedirectPreservesRequest(SETUP_PAGE_REDIRECT_STATUS)).toBe(false);
    expect(preserved.method).toBe("POST");
    expect(preserved.body).toContain("pw-bug029-must-not-reach-login");
    expect(preserved.body).toContain("tok-bug029-must-not-reach-login");

    const discarded = requestAfterHttpRedirect({
      method: "POST",
      body: formBody,
      location: SETUP_CLOSED_REDIRECT,
      status: SETUP_PAGE_REDIRECT_STATUS,
    });
    expect(SETUP_PAGE_REDIRECT_STATUS).toBe(303);
    expect(discarded.method).toBe("GET");
    expect(discarded.url).toBe("/login");
    expect(discarded.body).toBeNull();
    expect(JSON.stringify(discarded)).not.toContain("pw-bug029-must-not-reach-login");
    expect(JSON.stringify(discarded)).not.toContain("tok-bug029-must-not-reach-login");
    expect(urlContainsSetupSecrets(`http://localhost:3000${discarded.url}`, FIELDS)).toBe(false);
  });

  it("parses Next.js redirect digests without copying sensitive values", () => {
    const unsafe = parseNextRedirectDigest({
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    expect(unsafe).toEqual({ url: "/login", status: 307 });
    expect(httpRedirectPreservesRequest(unsafe!.status)).toBe(true);
    const safe = parseNextRedirectDigest({
      digest: "NEXT_REDIRECT;replace;/login;303;",
    });
    expect(safe).toEqual({ url: "/login", status: SETUP_PAGE_REDIRECT_STATUS });
    expect(httpRedirectPreservesRequest(safe!.status)).toBe(false);
  });

  it("keeps the hydrated bootstrap path as JSON POST, not a query URL", () => {
    expect(BETTER_AUTH_EMAIL_SIGN_UP_HTTP_METHOD).toBe("POST");
    expect(BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD).toBe("POST");
    expect(BETTER_AUTH_EMAIL_SIGN_UP_PATH).toBe("/api/auth/sign-up/email");
    expect(BETTER_AUTH_EMAIL_SIGN_IN_PATH).toBe("/api/auth/sign-in/email");
    expect(BETTER_AUTH_EMAIL_SIGN_UP_PATH).not.toMatch(/[?#]/);
    expect(SETUP_BOOTSTRAP_TOKEN_HEADER.toLowerCase()).toBe("x-gaming-bootstrap-token");
    const signUpUrl = new URL(BETTER_AUTH_EMAIL_SIGN_UP_PATH, "http://localhost:3000");
    expect(urlContainsSetupSecrets(signUpUrl.href, FIELDS)).toBe(false);
  });
});
