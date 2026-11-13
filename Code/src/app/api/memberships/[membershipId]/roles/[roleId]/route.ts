import { NextResponse } from "next/server";
import { assignRoleToMembership, removeRoleFromMembership } from "@/modules/identity";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

type Params = { params: Promise<{ membershipId: string; roleId: string }> };

export async function PUT(request: Request, context: Params) {
  return handleMutation(request, async () => {
    const { membershipId, roleId } = await context.params;
    const membership = requireUuidParam(membershipId, "Membership");
    const role = requireUuidParam(roleId, "Role");
    const { db, context: organizationContext } = await requireOrganization();
    await assignRoleToMembership(db, organizationContext.actor, membership, role);
    return NextResponse.json({ data: { membershipId: membership, roleId: role } });
  });
}

export async function DELETE(request: Request, context: Params) {
  return handleMutation(request, async () => {
    const { membershipId, roleId } = await context.params;
    const membership = requireUuidParam(membershipId, "Membership");
    const role = requireUuidParam(roleId, "Role");
    const { db, context: organizationContext } = await requireOrganization();
    await removeRoleFromMembership(db, organizationContext.actor, membership, role);
    return NextResponse.json({ data: { removed: true } });
  });
}
