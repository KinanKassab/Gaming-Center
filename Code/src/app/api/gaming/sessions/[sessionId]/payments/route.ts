import { NextResponse } from "next/server";
import {
  listSessionPayments,
  recordSessionPayment,
  recordSessionPaymentInputSchema,
  idempotencyKeySchema,
} from "@/modules/finance";
import { ValidationError } from "@/core/errors";
import {
  handle,
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

function readIdempotencyKey(request: Request, body: { idempotencyKey?: unknown }): string {
  const header = request.headers.get("idempotency-key")?.trim();
  if (header) return idempotencyKeySchema.parse(header);
  if (typeof body.idempotencyKey === "string") return idempotencyKeySchema.parse(body.idempotencyKey);
  throw new ValidationError("Idempotency-Key is required");
}

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handle(async () => {
    const { sessionId } = await context.params;
    const id = requireUuidParam(sessionId, "Session");
    const { db, context: organizationContext } = await requireOrganization();
    const payments = await listSessionPayments(db, organizationContext.actor, id);
    return NextResponse.json({ data: payments });
  });
}

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleMutation(request, async () => {
    const { sessionId } = await context.params;
    const id = requireUuidParam(sessionId, "Session");
    const { db, context: organizationContext } = await requireOrganization();
    const raw = await parseJsonBody(request);
    const body = recordSessionPaymentInputSchema.parse(raw);
    const idempotencyKey = readIdempotencyKey(request, body);
    const recorded = await recordSessionPayment(
      db,
      organizationContext.actor,
      id,
      body,
      idempotencyKey,
    );
    return NextResponse.json(
      { data: recorded.payment, checkout: recorded.checkout, replayed: recorded.replayed },
      { status: recorded.replayed ? 200 : 201 },
    );
  });
}
