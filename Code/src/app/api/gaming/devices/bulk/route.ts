import { NextResponse } from "next/server";
import { createDevicesBulk, createDevicesBulkInputSchema } from "@/modules/gaming";
import { handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createDevicesBulkInputSchema.parse(await parseJsonBody(request));
    const devices = await createDevicesBulk(db, context.actor, input);
    return NextResponse.json({ data: devices }, { status: 201 });
  });
}
