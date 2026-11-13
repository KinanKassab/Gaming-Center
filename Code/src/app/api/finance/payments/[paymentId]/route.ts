import { NextResponse } from "next/server";
import { getPayment } from "@/modules/finance";
import { handle, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function GET(_request: Request, context: { params: Promise<{ paymentId: string }> }) {
  return handle(async () => {
    const { paymentId } = await context.params;
    const id = requireUuidParam(paymentId, "Payment");
    const { db, context: organizationContext } = await requireOrganization();
    const payment = await getPayment(db, organizationContext.actor, id);
    return NextResponse.json({ data: payment });
  });
}
