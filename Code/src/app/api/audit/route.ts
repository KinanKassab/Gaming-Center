import { NextResponse } from "next/server";
import { z } from "zod";
import { listAuditLogs } from "@/modules/identity";
import { handle, requireOrganization } from "@/app/api/_lib/handler";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const logs = await listAuditLogs(db, context.actor, { limit: query.limit ?? 100 });
    return NextResponse.json({ data: logs });
  });
}
