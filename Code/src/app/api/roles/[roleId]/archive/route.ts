import { NextResponse } from "next/server";
import { archiveRole } from "@/modules/identity";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function POST(request: Request, context: { params: Promise<{ roleId: string }> }) {
  return handleMutation(request, async () => {
    const { roleId } = await context.params;
    const id = requireUuidParam(roleId, "Role");
    const { db, context: organizationContext } = await requireOrganization();
    const role = await archiveRole(db, organizationContext.actor, id);
    return NextResponse.json({ data: role });
  });
}
