import { NextResponse } from "next/server";
import { addDrinkToSession, addSessionDrinkInputSchema } from "@/modules/pos";
import {
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleMutation(request, async () => {
    const { sessionId } = await context.params;
    const id = requireUuidParam(sessionId, "Session");
    const { db, context: organizationContext } = await requireOrganization();
    const raw = await parseJsonBody(request);
    const input = addSessionDrinkInputSchema.parse(raw);
    const sale = await addDrinkToSession(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: sale }, { status: 201 });
  });
}
