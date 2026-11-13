/**
 * Gaming Floor Start is a client JSON POST to the canonical session API.
 * The HTML form is not a progressive start endpoint. Native/degraded submit
 * must fail closed: never GET-serialize Start fields into the Floor URL,
 * and never start a session without the JSON API.
 *
 * HTML's default form method is GET. A missing method is therefore a Floor
 * navigation leak (`?customerId=`).
 */

export const FLOOR_START_API_PATH = "/api/gaming/sessions";
export const FLOOR_START_API_METHOD = "POST";

/** Same-origin Floor page. No query string. CSP `form-action 'self'` allows this. */
export const FLOOR_START_NATIVE_ACTION = "/admin/gaming/floor";
export const FLOOR_START_NATIVE_METHOD = "post";

/** Named Start fields. Native GET would serialize these into the Floor URL. */
export const FLOOR_START_FIELD_NAMES = ["customerId"] as const;

const FLOOR_FILTER_QUERY_KEYS = ["branchId", "areaId", "deviceTypeId"] as const;

const START_LEAK_QUERY_KEYS = new Set<string>(
  FLOOR_START_FIELD_NAMES.map((name) => name.toLowerCase()),
);

export function htmlFormMethodIsGet(method: string | null | undefined): boolean {
  const value = method?.trim().toLowerCase() ?? "";
  return value === "" || value === "get";
}

export function isFloorStartLeakQueryKey(key: string): boolean {
  return START_LEAK_QUERY_KEYS.has(key.trim().toLowerCase());
}

function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function floorStartLeakQueryKeysPresent(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return Object.keys(params).some((key) => isFloorStartLeakQueryKey(key));
}

/**
 * If a Start field already appeared as a query key (legacy GET leak), send
 * the browser to a clean Floor URL. Preserve only Floor filter keys. Never
 * copy Start field values into the redirect.
 */
export function floorStartQueryRedirect(
  params: Record<string, string | string[] | undefined>,
): typeof FLOOR_START_NATIVE_ACTION | `${typeof FLOOR_START_NATIVE_ACTION}?${string}` | null {
  if (!floorStartLeakQueryKeysPresent(params)) return null;
  const next = new URLSearchParams();
  for (const key of FLOOR_FILTER_QUERY_KEYS) {
    const value = firstParam(params[key]);
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${FLOOR_START_NATIVE_ACTION}?${qs}` : FLOOR_START_NATIVE_ACTION;
}

export function isFloorDocumentPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === FLOOR_START_NATIVE_ACTION;
}

/** GET/HEAD Floor URL with leaked Start keys. Null when the document is already clean. */
export function floorStartGetLeakLocation(pathname: string, searchParams: URLSearchParams): string | null {
  if (!isFloorDocumentPath(pathname)) return null;
  const record: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (record[key] === undefined) {
      record[key] = value;
    }
  });
  return floorStartQueryRedirect(record);
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

export function urlContainsFloorStartFields(url: string, fields: Record<string, string>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://localhost");
  } catch {
    return false;
  }
  for (const key of parsed.searchParams.keys()) {
    if (isFloorStartLeakQueryKey(key)) return true;
  }
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (hash.includes("=")) {
    const hashParams = new URLSearchParams(hash);
    for (const key of hashParams.keys()) {
      if (isFloorStartLeakQueryKey(key)) return true;
    }
  }
  for (const value of Object.values(fields)) {
    if (!value) continue;
    if (parsed.search.includes(value) || parsed.hash.includes(value)) return true;
  }
  return false;
}

/** Native HTML form POST to the Floor page. Never intercept JSON Start API calls. */
export function shouldSeeOtherNativeFloorPost(input: {
  method: string;
  pathname: string;
  contentType: string | null;
}): boolean {
  if (input.method.toUpperCase() !== "POST") return false;
  const path = input.pathname.replace(/\/+$/, "") || "/";
  if (path !== FLOOR_START_NATIVE_ACTION) return false;
  const contentType = (input.contentType ?? "").toLowerCase();
  if (contentType.includes("application/json")) return false;
  return contentType.includes("application/x-www-form-urlencoded");
}

/** 303 Location: same Floor path/search, Start leak keys stripped, no body. */
export function floorNativePostSeeOtherLocation(url: string): string {
  const parsed = new URL(url, "http://localhost:3000");
  for (const key of [...parsed.searchParams.keys()]) {
    if (isFloorStartLeakQueryKey(key)) parsed.searchParams.delete(key);
  }
  parsed.hash = "";
  const qs = parsed.searchParams.toString();
  return qs ? `${parsed.pathname}?${qs}` : parsed.pathname;
}
