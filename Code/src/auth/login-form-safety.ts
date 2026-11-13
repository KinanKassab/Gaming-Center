/**
 * Login is a client Better Auth JSON POST. The HTML form is not a progressive
 * sign-in endpoint. Native/degraded submit must still fail closed: credentials
 * never become GET query params, URL search, or fragments.
 *
 * HTML's default form method is GET. A missing method is therefore a credential leak.
 */

export const BETTER_AUTH_EMAIL_SIGN_IN_PATH = "/api/auth/sign-in/email";
export const BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD = "POST";

/** Same-origin page action. No query string. CSP `form-action 'self'` allows this. */
export const LOGIN_FORM_NATIVE_ACTION = "/login";
export const LOGIN_FORM_NATIVE_METHOD = "post";

/** Named fields the login form reads. Native GET would serialize these into the URL. */
export const LOGIN_CREDENTIAL_FIELD_NAMES = ["email", "password"] as const;

const CREDENTIAL_QUERY_KEYS = new Set<string>(
  LOGIN_CREDENTIAL_FIELD_NAMES.map((name) => name.toLowerCase()),
);

export function htmlFormMethodIsGet(method: string | null | undefined): boolean {
  const value = method?.trim().toLowerCase() ?? "";
  return value === "" || value === "get";
}

export function isCredentialQueryKey(key: string): boolean {
  return CREDENTIAL_QUERY_KEYS.has(key.trim().toLowerCase());
}

export function credentialQueryKeysPresent(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return Object.keys(params).some((key) => isCredentialQueryKey(key));
}

/**
 * If a credential field already appeared as a query key (legacy GET leak),
 * send the browser to a clean login URL. Never copy values into the redirect.
 */
export function loginCredentialQueryRedirect(
  params: Record<string, string | string[] | undefined>,
): typeof LOGIN_FORM_NATIVE_ACTION | null {
  return credentialQueryKeysPresent(params) ? LOGIN_FORM_NATIVE_ACTION : null;
}

/**
 * WHATWG-style navigation URL after a native form submit (not the request body).
 * GET (or missing method) puts successful controls in the query string.
 * POST leaves those controls out of the URL.
 */
export function nativeFormNavigationUrl(options: {
  documentUrl: string;
  action: string;
  method: string | null | undefined;
  fields: Record<string, string>;
}): string {
  const documentUrl = new URL(options.documentUrl);
  const action = options.action.trim() === "" ? documentUrl.href : options.action;
  const target = new URL(action, documentUrl);
  if (!htmlFormMethodIsGet(options.method)) {
    return target.href;
  }
  for (const [name, value] of Object.entries(options.fields)) {
    target.searchParams.set(name, value);
  }
  return target.href;
}

export function urlContainsAuthCredentials(
  url: string,
  secrets: { email?: string; password?: string },
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
  const password = secrets.password;
  if (password && password.length > 0) {
    const needle = password.toLowerCase();
    if (haystacks.some((part) => part.toLowerCase().includes(needle))) return true;
  }
  for (const key of parsed.searchParams.keys()) {
    if (isCredentialQueryKey(key)) return true;
  }
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (hash.includes("=")) {
    const hashParams = new URLSearchParams(hash);
    for (const key of hashParams.keys()) {
      if (isCredentialQueryKey(key)) return true;
    }
  }
  return false;
}
