import { NextResponse } from "next/server";
import { getDeviceType, updateDeviceType, updateDeviceTypeInputSchema } from "@/modules/gaming";
import {
  handle,
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

export async function GET(_request: Request, context: { params: Promise<{ deviceTypeId: string }> }) {
  return handle(async () => {
    const { deviceTypeId } = await context.params;
    const id = requireUuidParam(deviceTypeId, "Device type");
    const { db, context: organizationContext } = await requireOrganization();
    const deviceType = await getDeviceType(db, organizationContext.actor, id);
    return NextResponse.json({ data: deviceType });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ deviceTypeId: string }> }) {
  return handleMutation(request, async () => {
    const { deviceTypeId } = await context.params;
    const id = requireUuidParam(deviceTypeId, "Device type");
    const { db, context: organizationContext } = await requireOrganization();
    const input = updateDeviceTypeInputSchema.parse(await parseJsonBody(request));
    const deviceType = await updateDeviceType(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: deviceType });
  });
}
