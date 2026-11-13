import { NextResponse } from "next/server";
import { archiveArea } from "@/modules/gaming";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function POST(_request: Request, context: { params: Promise<{ areaId: string }> }) {
  return handleMutation(_request, async () => {
    const { areaId } = await context.params;
    const id = requireUuidParam(areaId, "Area");
    const { db, context: organizationContext } = await requireOrganization();
    const area = await archiveArea(db, organizationContext.actor, id);
    return NextResponse.json({ data: area });
  });
}
