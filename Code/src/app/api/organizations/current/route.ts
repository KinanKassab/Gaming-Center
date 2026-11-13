import { NextResponse } from "next/server";
import {
  getOrganizationProfile,
  updateOrganizationProfile,
  updateOrganizationInputSchema,
} from "@/modules/identity";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET() {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const organization = await getOrganizationProfile(db, context.actor);
    return NextResponse.json({ data: organization });
  });
}

export async function PATCH(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = updateOrganizationInputSchema.parse(await parseJsonBody(request));
    const organization = await updateOrganizationProfile(db, context.actor, input);
    return NextResponse.json({ data: organization });
  });
}
