import { NextResponse } from "next/server";
import { archivePricingPlan, serializePricingPlan } from "@/modules/gaming";
import { handleMutation, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

export async function POST(_request: Request, context: { params: Promise<{ planId: string }> }) {
  return handleMutation(_request, async () => {
    const { planId } = await context.params;
    const id = requireUuidParam(planId, "Pricing plan");
    const { db, context: organizationContext } = await requireOrganization();
    const plan = await archivePricingPlan(db, organizationContext.actor, id);
    return NextResponse.json({ data: serializePricingPlan(plan) });
  });
}
