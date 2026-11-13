import { NextResponse } from "next/server";
import { pauseSession, pauseSessionInputSchema } from "@/modules/gaming";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";
import { ValidationError } from "@/core/errors";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleMutation(request, async () => {
    const { sessionId } = await context.params;
    const id = requireUuidParam(sessionId, "Session");
    const { db, context: organizationContext } = await requireOrganization();
    const raw = await request.text();
    let parsed: unknown = {};
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ValidationError("Request body must be valid JSON");
      }
    }
    const input = pauseSessionInputSchema.parse(parsed);
    const session = await pauseSession(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: session });
  });
}
