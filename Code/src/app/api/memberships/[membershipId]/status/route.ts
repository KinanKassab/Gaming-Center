import { NextResponse } from "next/server";
import { z } from "zod";
import { setMembershipStatus } from "@/modules/identity";
import { handleMutation, parseJsonBody, requireOrganization, requireUuidParam } from "@/app/api/_lib/handler";

const statusInputSchema = z.object({ action: z.enum(["suspend", "reactivate", "revoke"]) });

export async function POST(
  request: Request,
  context: { params: Promise<{ membershipId: string }> },
) {
  return handleMutation(request, async () => {
    const { membershipId } = await context.params;
    const id = requireUuidParam(membershipId, "Membership");
    const { db, context: organizationContext } = await requireOrganization();
    const input = statusInputSchema.parse(await parseJsonBody(request));
    const membership = await setMembershipStatus(db, organizationContext.actor, id, input.action);
    return NextResponse.json({ data: membership });
  });
}
