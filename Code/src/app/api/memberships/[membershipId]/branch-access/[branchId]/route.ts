import { NextResponse } from "next/server";
import {
  grantBranchAccess,
  grantBranchAccessInputSchema,
  revokeBranchAccess,
} from "@/modules/identity";
import { handleMutation, parseJsonBody, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

type Params = { params: Promise<{ membershipId: string; branchId: string }> };

export async function PUT(request: Request, context: Params) {
  return handleMutation(request, async () => {
    const { membershipId, branchId } = await context.params;
    const membership = requireUuidParam(membershipId, "Membership");
    const branch = requireUuidParam(branchId, "Branch");
    const { db, context: organizationContext } = await requireOrganization();
    const input = grantBranchAccessInputSchema.parse(await parseJsonBody(request));
    const grant = await grantBranchAccess(db, organizationContext.actor, membership, branch, input);
    return NextResponse.json({ data: grant });
  });
}

export async function DELETE(request: Request, context: Params) {
  return handleMutation(request, async () => {
    const { membershipId, branchId } = await context.params;
    const membership = requireUuidParam(membershipId, "Membership");
    const branch = requireUuidParam(branchId, "Branch");
    const { db, context: organizationContext } = await requireOrganization();
    await revokeBranchAccess(db, organizationContext.actor, membership, branch);
    return NextResponse.json({ data: { revoked: true } });
  });
}
