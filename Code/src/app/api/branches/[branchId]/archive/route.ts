import { NextResponse } from "next/server";
import { archiveBranch } from "@/modules/identity";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function POST(request: Request, context: { params: Promise<{ branchId: string }> }) {
  return handleMutation(request, async () => {
    const { branchId } = await context.params;
    const id = requireUuidParam(branchId, "Branch");
    const { db, context: organizationContext } = await requireOrganization();
    const branch = await archiveBranch(db, organizationContext.actor, id);
    return NextResponse.json({ data: branch });
  });
}
