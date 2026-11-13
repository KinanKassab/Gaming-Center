import { headers } from "next/headers";
import { AuthenticationError, AuthorizationError } from "@/core/errors";
import { getSafeRuntimeDb } from "@/db/client";
import { getSafeAuth } from "@/auth/auth";
import { authenticateRequest, loadSessionCoreUser, type AuthenticatedContext } from "@/auth/context";
import type { AppAuth } from "@/auth/auth";
import type { AppDatabase } from "@/db/client";

/**
 * Same Better Auth session lookup as authenticateRequest, without throwing
 * for missing/disabled sessions. Used by public pages that should skip login.
 */
export async function tryAuthenticateRequest(
  db: AppDatabase,
  auth: AppAuth,
  requestHeaders: Headers,
): Promise<AuthenticatedContext | null> {
  try {
    return await authenticateRequest(db, auth, requestHeaders);
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      return null;
    }
    throw error;
  }
}

export type PublicEntryHref = "/admin" | "/access-revoked" | null;

export function publicEntryHref(user: { status: string } | null): PublicEntryHref {
  if (!user) return null;
  if (user.status !== "ACTIVE") return "/access-revoked";
  return "/admin";
}

/** Authenticated visitors of / and /login go to the app. Unauthenticated stay. */
export function publicEntryPath(hasUsableSession: boolean): "/admin" | null {
  return hasUsableSession ? "/admin" : null;
}

/** Href for a public page when a session already exists. Null to stay. */
export async function authenticatedEntryHref(): Promise<PublicEntryHref> {
  const requestHeaders = new Headers(await headers());
  const db = await getSafeRuntimeDb();
  const auth = await getSafeAuth();
  const user = await loadSessionCoreUser(db, auth, requestHeaders);
  return publicEntryHref(user);
}
