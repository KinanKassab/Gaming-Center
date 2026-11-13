import { NextResponse } from "next/server";
import {
  createDevicePricing,
  createDevicePricingInputSchema,
  serializePricingPlan,
} from "@/modules/gaming";
import { handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createDevicePricingInputSchema.parse(await parseJsonBody(request));
    const created = await createDevicePricing(db, context.actor, input);
    return NextResponse.json(
      {
        data: {
          plan: serializePricingPlan(created.plan),
          assignments: created.assignments,
        },
      },
      { status: 201 },
    );
  });
}
