import { NextResponse } from "next/server";
import { createDevice, createDeviceInputSchema, listDevices, listDevicesInputSchema } from "@/modules/gaming";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = listDevicesInputSchema.parse({
      branchId: url.searchParams.get("branchId") || undefined,
      areaId: url.searchParams.get("areaId") || undefined,
      deviceTypeId: url.searchParams.get("deviceTypeId") || undefined,
      operationalStatus: url.searchParams.get("operationalStatus") || undefined,
      archived: url.searchParams.get("archived") || undefined,
      q: url.searchParams.get("q") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    const devices = await listDevices(db, context.actor, input);
    return NextResponse.json({ data: devices });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createDeviceInputSchema.parse(await parseJsonBody(request));
    const device = await createDevice(db, context.actor, input);
    return NextResponse.json({ data: device }, { status: 201 });
  });
}
