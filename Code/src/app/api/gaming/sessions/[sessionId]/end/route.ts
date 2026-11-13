import { NextResponse } from "next/server";
import { endSession } from "@/modules/gaming";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleMutation(_request, async () => {
    const { sessionId } = await context.params;
    const id = requireUuidParam(sessionId, "Session");
    const { db, context: organizationContext } = await requireOrganization();
    const session = await endSession(db, organizationContext.actor, id);
    return NextResponse.json({ data: session });
  });
}
