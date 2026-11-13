import { NextResponse } from "next/server";
import { updateBranch, updateBranchInputSchema } from "@/modules/identity";
import { handleMutation, parseJsonBody, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function PATCH(request: Request, context: { params: Promise<{ branchId: string }> }) {
  return handleMutation(request, async () => {
    const { branchId } = await context.params;
    const id = requireUuidParam(branchId, "Branch");
    const { db, context: organizationContext } = await requireOrganization();
    const input = updateBranchInputSchema.parse(await parseJsonBody(request));
    const branch = await updateBranch(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: branch });
  });
}
