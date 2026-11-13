import { NextResponse } from "next/server";
import { listFeatures } from "@/modules/settings";
import { handle, requireOrganization } from "@/app/api/_lib/handler";

export async function GET() {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const features = await listFeatures(db, context.actor);
    return NextResponse.json({ data: features });
  });
}
