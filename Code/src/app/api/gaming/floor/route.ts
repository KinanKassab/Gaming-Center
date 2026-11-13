import { NextResponse } from "next/server";
import { listFloor, listFloorInputSchema } from "@/modules/gaming";
import { handle, requireOrganization } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = listFloorInputSchema.parse({
      branchId: url.searchParams.get("branchId") || undefined,
      areaId: url.searchParams.get("areaId") || undefined,
      deviceTypeId: url.searchParams.get("deviceTypeId") || undefined,
    });
    const floor = await listFloor(db, context.actor, input);
    return NextResponse.json({ data: floor });
  });
}
