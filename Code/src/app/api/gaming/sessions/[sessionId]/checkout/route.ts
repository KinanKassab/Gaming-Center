import { NextResponse } from "next/server";
import { getSessionCheckout } from "@/modules/finance";
import { handle, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handle(async () => {
    const { sessionId } = await context.params;
    const id = requireUuidParam(sessionId, "Session");
    const { db, context: organizationContext } = await requireOrganization();
    const checkout = await getSessionCheckout(db, organizationContext.actor, id);
    return NextResponse.json({ data: checkout });
  });
}
