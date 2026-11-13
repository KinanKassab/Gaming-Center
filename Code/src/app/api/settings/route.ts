import { NextResponse } from "next/server";
import { listSettings } from "@/modules/settings";
import { handle, requireOrganization, uuidStringSchema } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const branchId = new URL(request.url).searchParams.get("branchId");
    const parsedBranchId = branchId ? uuidStringSchema.parse(branchId) : undefined;
    const settings = await listSettings(
      db,
      context.actor,
      parsedBranchId ? { branchId: parsedBranchId } : undefined,
    );
    return NextResponse.json({ data: settings, branchId: parsedBranchId ?? null });
  });
}
