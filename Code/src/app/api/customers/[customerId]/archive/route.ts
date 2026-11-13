import { NextResponse } from "next/server";
import { archiveCustomer } from "@/modules/customers";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function POST(_request: Request, context: { params: Promise<{ customerId: string }> }) {
  return handleMutation(_request, async () => {
    const { customerId } = await context.params;
    const id = requireUuidParam(customerId, "Customer");
    const { db, context: organizationContext } = await requireOrganization();
    const customer = await archiveCustomer(db, organizationContext.actor, id);
    return NextResponse.json({ data: customer });
  });
}
