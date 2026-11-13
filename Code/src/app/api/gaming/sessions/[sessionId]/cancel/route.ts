import { NextResponse } from "next/server";
import { cancelSession, cancelSessionInputSchema } from "@/modules/gaming";
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
    const input = cancelSessionInputSchema.parse(await parseJsonBody(request));
    const session = await cancelSession(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: session });
  });
}
