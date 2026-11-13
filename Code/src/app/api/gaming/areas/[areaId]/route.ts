import { NextResponse } from "next/server";
import { getArea, updateArea, updateAreaInputSchema } from "@/modules/gaming";
import {
  handle,
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

export async function GET(_request: Request, context: { params: Promise<{ areaId: string }> }) {
  return handle(async () => {
    const { areaId } = await context.params;
    const id = requireUuidParam(areaId, "Area");
    const { db, context: organizationContext } = await requireOrganization();
    const area = await getArea(db, organizationContext.actor, id);
    return NextResponse.json({ data: area });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ areaId: string }> }) {
  return handleMutation(request, async () => {
    const { areaId } = await context.params;
    const id = requireUuidParam(areaId, "Area");
    const { db, context: organizationContext } = await requireOrganization();
    const input = updateAreaInputSchema.parse(await parseJsonBody(request));
    const area = await updateArea(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: area });
  });
}
