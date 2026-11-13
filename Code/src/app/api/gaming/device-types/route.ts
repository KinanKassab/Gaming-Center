import { NextResponse } from "next/server";
import {
  createDeviceType,
  createDeviceTypeInputSchema,
  listDeviceTypes,
  listDeviceTypesInputSchema,
} from "@/modules/gaming";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = listDeviceTypesInputSchema.parse({
      status: url.searchParams.get("status") || undefined,
      q: url.searchParams.get("q") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    const deviceTypes = await listDeviceTypes(db, context.actor, input);
    return NextResponse.json({ data: deviceTypes });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createDeviceTypeInputSchema.parse(await parseJsonBody(request));
    const deviceType = await createDeviceType(db, context.actor, input);
    return NextResponse.json({ data: deviceType }, { status: 201 });
  });
}
