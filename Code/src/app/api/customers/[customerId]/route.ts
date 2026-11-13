import { NextResponse } from "next/server";
import { getCustomer, updateCustomer, updateCustomerInputSchema } from "@/modules/customers";
import {
  handle,
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

export async function GET(_request: Request, context: { params: Promise<{ customerId: string }> }) {
  return handle(async () => {
    const { customerId } = await context.params;
    const id = requireUuidParam(customerId, "Customer");
    const { db, context: organizationContext } = await requireOrganization();
    const customer = await getCustomer(db, organizationContext.actor, id);
    return NextResponse.json({ data: customer });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ customerId: string }> }) {
  return handleMutation(request, async () => {
    const { customerId } = await context.params;
    const id = requireUuidParam(customerId, "Customer");
    const { db, context: organizationContext } = await requireOrganization();
    const input = updateCustomerInputSchema.parse(await parseJsonBody(request));
    const result = await updateCustomer(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: result.customer, warnings: result.warnings });
  });
}
