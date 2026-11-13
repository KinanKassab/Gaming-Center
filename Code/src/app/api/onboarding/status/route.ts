import { NextResponse } from "next/server";
import { getGamingCenterSetupStatus } from "@/modules/onboarding/status";
import { handle, requireOrganization } from "@/app/api/_lib/handler";

export async function GET() {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const data = await getGamingCenterSetupStatus(db, context.actor);
    return NextResponse.json({ data });
  });
}
