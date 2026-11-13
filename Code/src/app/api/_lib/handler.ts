import { AsyncLocalStorage } from "node:async_hooks";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  AdminInvariantError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  TenantIsolationError,
  ValidationError,
} from "@/core/errors";
import { EnvironmentError, trustedAppOrigins } from "@/core/env";
import { createRequestId, getRequestLogContext, logError, runWithRequestLog } from "@/core/log";
import { getSafeRuntimeDb, type AppDatabase } from "@/db/client";
import { getSafeAuth, type AppAuth } from "@/auth/auth";
import {
  authenticateRequest,
  resolveOrganizationContext,
  type AuthenticatedContext,
  type OrganizationContext,
} from "@/auth/context";

/**
 * The cookie stores which of the user's organizations is selected. It is a
 * selector only: every request re-validates membership server-side, so a
 * tampered value can never grant access (ADR 0004 / ADR 0007).
 */
export const ORGANIZATION_COOKIE = "gc_organization_id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** UUID v7 (and other RFC 9562 variants). Zod's z.uuid() is too strict for v7. */
export const uuidStringSchema = z
  .string()
  .regex(UUID_PATTERN, "Invalid id");

export type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

export type RequestScope = {
  headers: Headers;
  cookies: CookieReader;
};

const requestScope = new AsyncLocalStorage<RequestScope>();

/** HTTP-test harness: supply session/org cookies without Next.js request globals. */
export function runWithRequestScope<T>(scope: RequestScope, fn: () => T): T {
  return requestScope.run(scope, fn);
}

export function organizationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function clearOrganizationCookie(response: NextResponse): void {
  response.cookies.set(ORGANIZATION_COOKIE, "", { ...organizationCookieOptions(), maxAge: 0 });
}

/**
 * Same-origin CSRF gate for cookie-authenticated JSON mutations.
 *
 * Production (fail closed): Origin is required and must match a trusted
 * origin. Production (including Vercel Production) trusts only APP_BASE_URL.
 * Vercel Preview additionally trusts Vercel-provided *.vercel.app hosts
 * (VERCEL_URL / VERCEL_BRANCH_URL). Host and X-Forwarded-Host are never used.
 * Non-production: missing Origin is allowed for curl/tests; a present Origin
 * still must match.
 *
 * SameSite=Lax cookies remain the browser-level mitigation. This is not a
 * CSRF token. Cross-origin admin clients are not supported.
 */
export function assertSameOriginMutation(request: Request, env = process.env.NODE_ENV): void {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  let allowed: string[];
  try {
    allowed = trustedAppOrigins(env);
  } catch (error) {
    if (error instanceof EnvironmentError) {
      throw new AuthorizationError("Cross-origin request blocked");
    }
    throw error;
  }
  if (!origin) {
    if (env === "production") {
      throw new AuthorizationError("Cross-origin request blocked");
    }
    return;
  }
  if (!allowed.includes(origin)) {
    throw new AuthorizationError("Cross-origin request blocked");
  }
}

function requestIdFromHeaders(headerList: Headers): string {
  const incoming = headerList.get("x-request-id")?.trim();
  if (incoming && incoming.length > 0 && incoming.length <= 128) return incoming;
  return getRequestLogContext()?.requestId ?? createRequestId();
}

async function requestHeaders(): Promise<Headers> {
  const scoped = requestScope.getStore();
  if (scoped) return scoped.headers;
  return new Headers(await headers());
}

export async function requireAuthenticated(): Promise<{
  db: AppDatabase;
  auth: AppAuth;
  context: AuthenticatedContext;
}> {
  const db = await getSafeRuntimeDb();
  const auth = await getSafeAuth();
  const context = await authenticateRequest(db, auth, await requestHeaders());
  return { db, auth, context };
}

export async function selectedOrganizationId(): Promise<string | null> {
  const scoped = requestScope.getStore();
  const value = scoped
    ? (scoped.cookies.get(ORGANIZATION_COOKIE)?.value ?? null)
    : ((await cookies()).get(ORGANIZATION_COOKIE)?.value ?? null);
  return value && UUID_PATTERN.test(value) ? value : null;
}

export async function requireOrganization(): Promise<{
  db: AppDatabase;
  auth: AppAuth;
  context: OrganizationContext;
}> {
  const { db, auth, context } = await requireAuthenticated();
  const organizationId = await selectedOrganizationId();
  const organizationContext = await resolveOrganizationContext(db, context, organizationId);
  return { db, auth, context: organizationContext };
}

/** Validates a route path parameter that must be a UUID. */
export function requireUuidParam(value: string, entity: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationError(`Invalid ${entity} id`);
  }
  return value.toLowerCase();
}

function fieldErrorsFromZod(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join(".") : "",
    message: issue.message,
  }));
}

function errorBody(
  code: string,
  message: string,
  requestId: string,
  extra?: { reason?: string; fields?: Array<{ path: string; message: string }> },
) {
  return {
    error: {
      code,
      message,
      requestId,
      ...(extra?.reason ? { reason: extra.reason } : {}),
      ...(extra?.fields ? { fields: extra.fields } : {}),
    },
  };
}

function errorResponse(error: unknown, requestId: string): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      errorBody("INVALID_INPUT", "Invalid input", requestId, {
        reason: "invalid_input",
        fields: fieldErrorsFromZod(error),
      }),
      { status: 400 },
    );
  }
  if (error instanceof ValidationError) {
    return NextResponse.json(
      errorBody("INVALID_INPUT", error.message, requestId, {
        reason: error.reason ?? "invalid_input",
      }),
      { status: 400 },
    );
  }
  if (error instanceof AuthenticationError) {
    return NextResponse.json(errorBody("UNAUTHENTICATED", error.message, requestId), { status: 401 });
  }
  if (error instanceof AuthorizationError || error instanceof TenantIsolationError) {
    return NextResponse.json(errorBody("FORBIDDEN", error.message, requestId), { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json(errorBody("NOT_FOUND", error.message, requestId), { status: 404 });
  }
  if (error instanceof ConflictError || error instanceof AdminInvariantError) {
    const reason = error instanceof ConflictError ? error.reason : undefined;
    return NextResponse.json(
      errorBody("CONFLICT", error.message, requestId, reason ? { reason } : undefined),
      { status: 409 },
    );
  }
  logError("api.unhandled", error, { category: "internal" });
  return NextResponse.json(errorBody("INTERNAL", "Internal server error", requestId), { status: 500 });
}

async function withMappedErrors(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  const headerList = await requestHeaders();
  const requestId = requestIdFromHeaders(headerList);
  const route = headerList.get("x-invoke-path")?.trim();
  const logContext = route ? { requestId, route } : { requestId };
  return runWithRequestLog(logContext, async () => {
    try {
      const response = await fn();
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      const response = errorResponse(error, requestId);
      response.headers.set("x-request-id", requestId);
      return response;
    }
  });
}

/** Wraps a route handler with domain-error-to-HTTP mapping. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return withMappedErrors(fn);
}

/** Mutation wrapper: same-origin Origin check, then domain-error mapping. */
export async function handleMutation(
  request: Request,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  return handle(async () => {
    assertSameOriginMutation(request);
    return fn();
  });
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}
