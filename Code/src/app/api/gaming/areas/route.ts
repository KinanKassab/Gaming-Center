import { NextResponse } from "next/server";
import { createArea, createAreaInputSchema, listAreas, listAreasInputSchema } from "@/modules/gaming";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = listAreasInputSchema.parse({
      branchId: url.searchParams.get("branchId") || undefined,
      status: url.searchParams.get("status") || undefined,
      q: url.searchParams.get("q") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    const areas = await listAreas(db, context.actor, input);
    return NextResponse.json({ data: areas });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createAreaInputSchema.parse(await parseJsonBody(request));
    const area = await createArea(db, context.actor, input);
    return NextResponse.json({ data: area }, { status: 201 });
  });
}
