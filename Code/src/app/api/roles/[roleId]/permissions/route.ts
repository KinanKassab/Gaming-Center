import { NextResponse } from "next/server";
import { setRolePermissions, setRolePermissionsInputSchema } from "@/modules/identity";
import { handleMutation, parseJsonBody, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function PUT(request: Request, context: { params: Promise<{ roleId: string }> }) {
  return handleMutation(request, async () => {
    const { roleId } = await context.params;
    const id = requireUuidParam(roleId, "Role");
    const { db, context: organizationContext } = await requireOrganization();
    const input = setRolePermissionsInputSchema.parse(await parseJsonBody(request));
    const result = await setRolePermissions(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: result });
  });
}
