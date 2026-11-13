import { and, eq } from "drizzle-orm";
import { AuthenticationError, AuthorizationError } from "@/core/errors";
import type { BranchAccessMode } from "@/core/tenancy";
import { coreOrganizationMemberships, coreOrganizations } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import {
  applyDueStaffPurge,
  ensureCoreUser,
  loadBranchAccess,
  loadEffectivePermissions,
  type CoreUser,
  type OrganizationActor,
} from "@/modules/identity";
import type { AppAuth } from "@/auth/auth";

/**
 * Authorization pipeline (used by every protected route and page):
 *
 *   authenticate (Better Auth session)
 *     -> resolve Core User (auth_subject mapping; reject non-ACTIVE users)
 *     -> validate ACTIVE organization membership for the *selected* organization
 *     -> load effective permissions (union of ACTIVE roles)
 *     -> load explicit branch access
 *     -> use-cases enforce permission / branch checks and audit
 *
 * The selected organization id (cookie) is only a selector: access is granted
 * exclusively by the membership lookup below, never by the client value.
 */

export type AuthenticatedContext = {
  /** Core User with status ACTIVE. */
  user: CoreUser;
};

export type OrganizationContext = AuthenticatedContext & {
  organization: { id: string; slug: string; name: string; status: string };
  actor: OrganizationActor;
};

/** Session Core User including DISABLED accounts. Applies due 30-day purge. */
export async function loadSessionCoreUser(
  db: AppDatabase,
  auth: AppAuth,
  headers: Headers,
): Promise<CoreUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const user = await ensureCoreUser(db, {
    authSubject: session.user.id,
    email: session.user.email ?? null,
    displayName: session.user.name || session.user.email || "User",
  });
  return applyDueStaffPurge(db, user);
}

/** WHO is the user? Rejects missing sessions and disabled application users. */
export async function authenticateRequest(
  db: AppDatabase,
  auth: AppAuth,
  headers: Headers,
): Promise<AuthenticatedContext> {
  const user = await loadSessionCoreUser(db, auth, headers);
  if (!user) {
    throw new AuthenticationError("Not authenticated");
  }
  if (user.status !== "ACTIVE") {
    throw new AuthorizationError("User account is disabled");
  }
  return { user };
}

/**
 * WHICH organization is the user acting inside, and WHAT may they do there?
 * Never reveals whether an organization exists when the user has no access.
 */
export async function resolveOrganizationContext(
  db: AppDatabase,
  authContext: AuthenticatedContext,
  selectedOrganizationId: string | null | undefined,
): Promise<OrganizationContext> {
  if (!selectedOrganizationId) {
    throw new AuthorizationError("No organization selected");
  }
  const userId = authContext.user.id;

  return withTenant(db, { organizationId: selectedOrganizationId, userId }, async (tx) => {
    const membershipRows = await tx
      .select({
        id: coreOrganizationMemberships.id,
        status: coreOrganizationMemberships.status,
      })
      .from(coreOrganizationMemberships)
      .where(
        and(
          eq(coreOrganizationMemberships.organizationId, selectedOrganizationId),
          eq(coreOrganizationMemberships.userId, userId),
        ),
      )
      .limit(1);
    const membership = membershipRows[0];
    if (!membership) {
      throw new AuthorizationError("No access to this organization");
    }
    if (membership.status === "INVITED") {
      throw new AuthorizationError("Invitation has not been accepted yet");
    }
    if (membership.status !== "ACTIVE") {
      throw new AuthorizationError("Membership is suspended");
    }

    const organizationRows = await tx
      .select({
        id: coreOrganizations.id,
        slug: coreOrganizations.slug,
        name: coreOrganizations.name,
        status: coreOrganizations.status,
      })
      .from(coreOrganizations)
      .where(eq(coreOrganizations.id, selectedOrganizationId))
      .limit(1);
    const organization = organizationRows[0];
    if (!organization) {
      throw new AuthorizationError("No access to this organization");
    }
    if (organization.status !== "ACTIVE") {
      throw new AuthorizationError("Organization is not active");
    }

    const permissions = await loadEffectivePermissions(tx, selectedOrganizationId, membership.id);
    const branchAccess = await loadBranchAccess(tx, selectedOrganizationId, membership.id);

    return {
      user: authContext.user,
      organization,
      actor: {
        userId,
        organizationId: selectedOrganizationId,
        membershipId: membership.id,
        permissions,
        branchAccess: branchAccess.map((row) => ({
          branchId: row.branchId,
          accessMode: row.accessMode as BranchAccessMode,
        })),
      },
    };
  });
}
