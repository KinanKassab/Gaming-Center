import { NextResponse } from "next/server";
import { archiveDevice } from "@/modules/gaming";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function POST(_request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return handleMutation(_request, async () => {
    const { deviceId } = await context.params;
    const id = requireUuidParam(deviceId, "Device");
    const { db, context: organizationContext } = await requireOrganization();
    const device = await archiveDevice(db, organizationContext.actor, id);
    return NextResponse.json({ data: device });
  });
}
