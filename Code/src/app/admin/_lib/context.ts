import { headers } from "next/headers";
import { AuthorizationError, TenantIsolationError } from "@/core/errors";
import { getSafeRuntimeDb, type AppDatabase } from "@/db/client";
import { getSafeAuth, type AppAuth } from "@/auth/auth";
import {
  loadSessionCoreUser,
  resolveOrganizationContext,
  type AuthenticatedContext,
  type OrganizationContext,
} from "@/auth/context";
import { selectedOrganizationId } from "@/app/api/_lib/handler";

export type AdminPageContext = {
  db: AppDatabase;
  auth: AppAuth;
  /** Null when there is no usable session. Callers must HardRedirect to /login. */
  viewer: AuthenticatedContext | null;
  /** True when a session exists but the Core User is disabled. */
  accessRevoked: boolean;
  /** Null when no organization is selected or the selection is not accessible. */
  organization: OrganizationContext | null;
};

/**
 * Server-component context for admin pages. Does not call `next/navigation`
 * `redirect()` — that unmounts OuterLayoutRouter during client transitions.
 */
export async function getAdminPageContext(): Promise<AdminPageContext> {
  const requestHeaders = new Headers(await headers());
  const db = await getSafeRuntimeDb();
  const auth = await getSafeAuth();
  const sessionUser = await loadSessionCoreUser(db, auth, requestHeaders);
  if (!sessionUser) {
    return { db, auth, viewer: null, accessRevoked: false, organization: null };
  }
  if (sessionUser.status !== "ACTIVE") {
    return { db, auth, viewer: null, accessRevoked: true, organization: null };
  }
  const viewer: AuthenticatedContext = { user: sessionUser };

  let organization: OrganizationContext | null = null;
  const organizationId = await selectedOrganizationId();
  if (organizationId) {
    try {
      organization = await resolveOrganizationContext(db, viewer, organizationId);
    } catch (error) {
      if (!(error instanceof AuthorizationError) && !(error instanceof TenantIsolationError)) {
        throw error;
      }
      organization = null;
    }
  }

  return { db, auth, viewer, accessRevoked: false, organization };
}
