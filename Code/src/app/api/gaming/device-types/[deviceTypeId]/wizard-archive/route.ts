import { NextResponse } from "next/server";
import { archiveWizardDeviceType } from "@/modules/gaming";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function POST(_request: Request, context: { params: Promise<{ deviceTypeId: string }> }) {
  return handleMutation(_request, async () => {
    const { deviceTypeId } = await context.params;
    const id = requireUuidParam(deviceTypeId, "Device type");
    const { db, context: organizationContext } = await requireOrganization();
    const deviceType = await archiveWizardDeviceType(db, organizationContext.actor, id);
    return NextResponse.json({ data: deviceType });
  });
}
