import { NextResponse } from "next/server";
import {
  idempotencyKeySchema,
  recordExpense,
  recordExpenseInputSchema,
} from "@/modules/finance";
import { ValidationError } from "@/core/errors";
import { handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

function readIdempotencyKey(request: Request, body: { idempotencyKey?: unknown }): string {
  const header = request.headers.get("idempotency-key")?.trim();
  if (header) return idempotencyKeySchema.parse(header);
  if (typeof body.idempotencyKey === "string") return idempotencyKeySchema.parse(body.idempotencyKey);
  throw new ValidationError("Idempotency-Key is required");
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context: organizationContext } = await requireOrganization();
    const raw = await parseJsonBody(request);
    const body = recordExpenseInputSchema.parse(raw);
    const idempotencyKey = readIdempotencyKey(request, body);
    const recorded = await recordExpense(db, organizationContext.actor, body, idempotencyKey);
    return NextResponse.json(
      { data: recorded.expense, replayed: recorded.replayed },
      { status: recorded.replayed ? 200 : 201 },
    );
  });
}
