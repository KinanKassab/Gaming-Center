import { NextResponse } from "next/server";
import { createRole, createRoleInputSchema, listRoles } from "@/modules/identity";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET() {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const roles = await listRoles(db, context.actor);
    return NextResponse.json({ data: roles });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createRoleInputSchema.parse(await parseJsonBody(request));
    const role = await createRole(db, context.actor, input);
    return NextResponse.json({ data: role }, { status: 201 });
  });
}
