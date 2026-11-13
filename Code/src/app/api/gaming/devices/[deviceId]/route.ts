import { NextResponse } from "next/server";
import { getDevice, updateDevice, updateDeviceInputSchema } from "@/modules/gaming";
import {
  handle,
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

export async function GET(_request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return handle(async () => {
    const { deviceId } = await context.params;
    const id = requireUuidParam(deviceId, "Device");
    const { db, context: organizationContext } = await requireOrganization();
    const device = await getDevice(db, organizationContext.actor, id);
    return NextResponse.json({ data: device });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return handleMutation(request, async () => {
    const { deviceId } = await context.params;
    const id = requireUuidParam(deviceId, "Device");
    const { db, context: organizationContext } = await requireOrganization();
    const input = updateDeviceInputSchema.parse(await parseJsonBody(request));
    const device = await updateDevice(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: device });
  });
}
