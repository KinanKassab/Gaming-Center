import { NextResponse } from "next/server";
import {
  getPricingAssignment,
  updatePricingAssignment,
  updatePricingAssignmentInputSchema,
} from "@/modules/gaming";
import {
  handle,
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

export async function GET(_request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  return handle(async () => {
    const { assignmentId } = await context.params;
    const id = requireUuidParam(assignmentId, "Pricing assignment");
    const { db, context: organizationContext } = await requireOrganization();
    const assignment = await getPricingAssignment(db, organizationContext.actor, id);
    return NextResponse.json({ data: assignment });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  return handleMutation(request, async () => {
    const { assignmentId } = await context.params;
    const id = requireUuidParam(assignmentId, "Pricing assignment");
    const { db, context: organizationContext } = await requireOrganization();
    const input = updatePricingAssignmentInputSchema.parse(await parseJsonBody(request));
    const assignment = await updatePricingAssignment(db, organizationContext.actor, id, input);
    return NextResponse.json({ data: assignment });
  });
}
