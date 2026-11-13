import { NextResponse } from "next/server";
import { AuthorizationError, TenantIsolationError } from "@/core/errors";
import { resolveOrganizationContext } from "@/auth/context";
import { listUserMemberships } from "@/modules/identity";
import { handle, requireAuthenticated, selectedOrganizationId } from "@/app/api/_lib/handler";

/** WHO am I, WHICH organizations can I enter, WHAT can I do in the selected one? */
export async function GET() {
  return handle(async () => {
    const { db, context } = await requireAuthenticated();
    const memberships = await listUserMemberships(db, context.user.id);

    const organizationId = await selectedOrganizationId();
    let current = null;
    if (organizationId) {
      try {
        const organizationContext = await resolveOrganizationContext(db, context, organizationId);
        current = {
          organization: organizationContext.organization,
          membershipId: organizationContext.actor.membershipId,
          permissions: organizationContext.actor.permissions,
          branchAccess: organizationContext.actor.branchAccess,
        };
      } catch (error) {
        // Stale or revoked selection: report no current organization.
        if (!(error instanceof AuthorizationError) && !(error instanceof TenantIsolationError)) {
          throw error;
        }
        current = null;
      }
    }

    return NextResponse.json({
      data: {
        user: {
          id: context.user.id,
          displayName: context.user.displayName,
          email: context.user.email,
        },
        memberships,
        current,
      },
    });
  });
}
