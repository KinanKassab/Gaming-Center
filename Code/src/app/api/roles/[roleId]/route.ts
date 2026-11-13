import { NextResponse } from "next/server";
import { updateRole, updateRoleInputSchema } from "@/modules/identity";
import { handleMutation, parseJsonBody, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function PATCH(request: Request, context: { params: Promise<{ roleId: string }> }) {
  return handleMutation(request, async () => {
    const { roleId } = await context.params;
    const id = requireUuidParam(roleId, "Role");
    const { db, context: organizationContext } = await requireOrganization();
    const input = updateRoleInputSchema.parse(await parseJsonBody(request));
    const role = await updateRole(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: role });
  });
}
