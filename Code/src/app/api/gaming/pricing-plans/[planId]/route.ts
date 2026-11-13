import { NextResponse } from "next/server";
import {
  getPricingPlan,
  serializePricingPlan,
  updatePricingPlan,
  updatePricingPlanInputSchema,
} from "@/modules/gaming";
import {
  handle,
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

export async function GET(_request: Request, context: { params: Promise<{ planId: string }> }) {
  return handle(async () => {
    const { planId } = await context.params;
    const id = requireUuidParam(planId, "Pricing plan");
    const { db, context: organizationContext } = await requireOrganization();
    const plan = await getPricingPlan(db, organizationContext.actor, id);
    return NextResponse.json({ data: serializePricingPlan(plan) });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ planId: string }> }) {
  return handleMutation(request, async () => {
    const { planId } = await context.params;
    const id = requireUuidParam(planId, "Pricing plan");
    const { db, context: organizationContext } = await requireOrganization();
    const input = updatePricingPlanInputSchema.parse(await parseJsonBody(request));
    const plan = await updatePricingPlan(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: serializePricingPlan(plan) });
  });
}
