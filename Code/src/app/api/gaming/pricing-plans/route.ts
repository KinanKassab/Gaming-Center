import { NextResponse } from "next/server";
import {
  createPricingPlan,
  createPricingPlanInputSchema,
  listPricingPlans,
  listPricingPlansInputSchema,
  serializePricingPlan,
} from "@/modules/gaming";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = listPricingPlansInputSchema.parse({
      status: url.searchParams.get("status") || undefined,
      q: url.searchParams.get("q") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    const plans = await listPricingPlans(db, context.actor, input);
    return NextResponse.json({ data: plans.map(serializePricingPlan) });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createPricingPlanInputSchema.parse(await parseJsonBody(request));
    const plan = await createPricingPlan(db, context.actor, input);
    return NextResponse.json({ data: serializePricingPlan(plan) }, { status: 201 });
  });
}
