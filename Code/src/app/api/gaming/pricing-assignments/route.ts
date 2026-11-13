import { NextResponse } from "next/server";
import {
  createPricingAssignment,
  createPricingAssignmentInputSchema,
  listPricingAssignments,
  listPricingAssignmentsInputSchema,
} from "@/modules/gaming";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = listPricingAssignmentsInputSchema.parse({
      pricingPlanId: url.searchParams.get("pricingPlanId") || undefined,
      scopeType: url.searchParams.get("scopeType") || undefined,
      branchId: url.searchParams.get("branchId") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    const assignments = await listPricingAssignments(db, context.actor, input);
    return NextResponse.json({ data: assignments });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createPricingAssignmentInputSchema.parse(await parseJsonBody(request));
    const assignment = await createPricingAssignment(db, context.actor, input);
    return NextResponse.json({ data: assignment }, { status: 201 });
  });
}
