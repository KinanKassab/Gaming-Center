import { NextResponse } from "next/server";
import { requireFeatureCode, setFeatureInputSchema, setOrganizationFeature } from "@/modules/settings";
import { handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function PUT(request: Request, context: { params: Promise<{ code: string }> }) {
  return handleMutation(request, async () => {
    const { code } = await context.params;
    const featureCode = requireFeatureCode(code);
    const { db, context: organizationContext } = await requireOrganization();
    const input = setFeatureInputSchema.parse(await parseJsonBody(request));
    const result = await setOrganizationFeature(db, organizationContext.actor, featureCode, input);
    return NextResponse.json({ data: result });
  });
}
