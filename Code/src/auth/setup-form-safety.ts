/**
 * First-owner setup is a client Better Auth JSON POST (sign-up + sign-in).
 * The HTML form is not a progressive bootstrap endpoint. Native/degraded submit
 * must still fail closed: name, email, password, and bootstrap token never
 * become GET query params, URL search, or fragments.
 *
 * HTML's default form method is GET. A missing method is therefore a secret leak.
 */

import {
  BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD,
  BETTER_AUTH_EMAIL_SIGN_IN_PATH,
  htmlFormMethodIsGet,
  nativeFormNavigationUrl,
} from "@/auth/login-form-safety";
import { FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER } from "@/core/env";

export {
  BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD,
  BETTER_AUTH_EMAIL_SIGN_IN_PATH,
  htmlFormMethodIsGet,
  nativeFormNavigationUrl,
};

export const BETTER_AUTH_EMAIL_SIGN_UP_PATH = "/api/auth/sign-up/email";
export const BETTER_AUTH_EMAIL_SIGN_UP_HTTP_METHOD = "POST";

/** Same header Better Auth HTTP signup gating expects. Never put this value in a URL. */
export const SETUP_BOOTSTRAP_TOKEN_HEADER = FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER;

/** Same-origin page action. No query string. CSP `form-action 'self'` allows this. */
export const SETUP_FORM_NATIVE_ACTION = "/setup";
export const SETUP_FORM_NATIVE_METHOD = "post";

/** Where /setup goes once the first owner already exists. */
export const SETUP_CLOSED_REDIRECT = "/login";

/**
 * Body-discarding redirect. Next.js `redirect()` from a Server Component always
 * uses 307 Temporary Redirect, which replays POST method and body. 303 See Other
 * is `RedirectStatusCode.SeeOther` in this Next.js version: the browser follows
 * with GET and must not forward the original body.
 *
 * Server Actions get 303 automatically. Closed `/setup` never renders a form
 * (and therefore has no Server Action), so setup page navigation must opt in.
 */
export const SETUP_PAGE_REDIRECT_STATUS = 303;

export function httpRedirectPreservesRequest(status: number): boolean {
  return status === 307 || status === 308;
}

/**
 * WHATWG/RFC follow of a redirect response. 303 becomes GET with no body.
 * 307/308 keep the original method and body.
 */
export function requestAfterHttpRedirect(input: {
  method: string;
  body: string | null;
  location: string;
  status: number;
}): { method: string; url: string; body: string | null } {
  if (httpRedirectPreservesRequest(input.status)) {
    return {
      method: input.method.toUpperCase(),
      url: input.location,
      body: input.body,
    };
  }
  return { method: "GET", url: input.location, body: null };
}

/** Decode a Next.js `NEXT_REDIRECT;type;url;status;` digest. Values are never copied. */
export function parseNextRedirectDigest(
  error: unknown,
): { url: string; status: number } | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const digest = String((error as { digest?: unknown }).digest ?? "");
  if (!digest.startsWith("NEXT_REDIRECT;")) return null;
  const parts = digest.split(";");
  if (parts.length < 5) return null;
  const statusRaw = parts[parts.length - 2];
  const status = Number(statusRaw);
  const url = parts.slice(2, -2).join(";");
  if (!Number.isInteger(status) || url.length === 0) return null;
  return { url, status };
}

/** Named fields the setup form reads. Native GET would serialize these into the URL. */
export const SETUP_SENSITIVE_FIELD_NAMES = ["name", "email", "password", "bootstrapToken"] as const;

const SENSITIVE_QUERY_KEYS = new Set<string>(
  SETUP_SENSITIVE_FIELD_NAMES.map((name) => name.toLowerCase()),
);

export function isSetupSensitiveQueryKey(key: string): boolean {
  return SENSITIVE_QUERY_KEYS.has(key.trim().toLowerCase());
}

export function setupSensitiveQueryKeysPresent(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return Object.keys(params).some((key) => isSetupSensitiveQueryKey(key));
}

/**
 * If a setup field already appeared as a query key (legacy GET leak), send the
 * browser to a clean /setup URL. Never copy values into the redirect.
 * Existing-owner gating runs on the subsequent clean request.
 */
export function setupSensitiveQueryRedirect(
  params: Record<string, string | string[] | undefined>,
): typeof SETUP_FORM_NATIVE_ACTION | null {
  return setupSensitiveQueryKeysPresent(params) ? SETUP_FORM_NATIVE_ACTION : null;
}

/**
 * Server navigation for GET/POST /setup. Sensitive query keys are stripped
 * before the existing-owner hop so /login is not requested with a Referer
 * that still contains setup secrets.
 */
export function resolveSetupPageNavigation(input: {
  firstUserRequired: boolean;
  searchParams: Record<string, string | string[] | undefined>;
}): typeof SETUP_FORM_NATIVE_ACTION | typeof SETUP_CLOSED_REDIRECT | null {
  if (setupSensitiveQueryRedirect(input.searchParams)) {
    return SETUP_FORM_NATIVE_ACTION;
  }
  if (!input.firstUserRequired) {
    return SETUP_CLOSED_REDIRECT;
  }
  return null;
}

export function urlContainsSetupSecrets(
  url: string,
  secrets: { name?: string; email?: string; password?: string; bootstrapToken?: string },
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://localhost");
  } catch {
    return false;
  }
  const rawQuery = parsed.search + parsed.hash;
  let decodedQuery = rawQuery;
  try {
    decodedQuery = decodeURIComponent(rawQuery);
  } catch {
    decodedQuery = rawQuery;
  }
  const haystacks = [parsed.search, parsed.hash, decodedQuery];
  for (const value of [secrets.password, secrets.bootstrapToken, secrets.email]) {
    if (value && value.length > 0) {
      const needle = value.toLowerCase();
      if (haystacks.some((part) => part.toLowerCase().includes(needle))) return true;
    }
  }
  for (const key of parsed.searchParams.keys()) {
    if (isSetupSensitiveQueryKey(key)) return true;
  }
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (hash.includes("=")) {
    const hashParams = new URLSearchParams(hash);
    for (const key of hashParams.keys()) {
      if (isSetupSensitiveQueryKey(key)) return true;
    }
  }
  return false;
}
