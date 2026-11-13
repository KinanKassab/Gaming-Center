import { NextResponse } from "next/server";
import {
  listSessions,
  listSessionsInputSchema,
  startSession,
  startSessionInputSchema,
} from "@/modules/gaming";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = listSessionsInputSchema.parse({
      branchId: url.searchParams.get("branchId") || undefined,
      deviceId: url.searchParams.get("deviceId") || undefined,
      customerId: url.searchParams.get("customerId") || undefined,
      status: url.searchParams.get("status") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      offset: url.searchParams.get("offset") || undefined,
    });
    const sessions = await listSessions(db, context.actor, input);
    return NextResponse.json({ data: sessions });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = startSessionInputSchema.parse(await parseJsonBody(request));
    const session = await startSession(db, context.actor, input);
    return NextResponse.json({ data: session }, { status: 201 });
  });
}
