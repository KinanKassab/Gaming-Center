import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthorizationError, ConflictError } from "@/core/errors";
import { PERMISSIONS } from "@/modules/identity";
import { getGamingCenterSetupStatus } from "@/modules/onboarding/status";
import {
  GUIDED_SETUP_DONE_COOKIE,
  appendGuidedSetupDoneOrg,
  applyGuidedSetupDoneCookie,
} from "@/modules/onboarding/presentation";
import { readCookieFromHeader } from "@/i18n/cookie";
import { handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

const inputSchema = z.object({
  action: z.literal("complete"),
});

/**
 * Records Guided Setup Finish for the current organization.
 * Presentation cookie only. Does not change operationallyReady.
 */
export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const canSetup =
      context.actor.permissions.includes(PERMISSIONS.branchesManage) ||
      context.actor.permissions.includes(PERMISSIONS.gamingMasterManage);
    if (!canSetup) {
      throw new AuthorizationError("Not allowed to complete guided setup");
    }
    inputSchema.parse(await parseJsonBody(request));
    const setup = await getGamingCenterSetupStatus(db, context.actor);
    if (!setup.operationallyReady) {
      throw new ConflictError("Guided setup can be finished after the center is operationally ready");
    }
    const organizationId = context.organization.id;
    const existing = readCookieFromHeader(request.headers.get("cookie"), GUIDED_SETUP_DONE_COOKIE);
    const value = appendGuidedSetupDoneOrg(existing, organizationId);
    const response = NextResponse.json({
      data: { completed: true, organizationId, operationallyReady: setup.operationallyReady },
    });
    applyGuidedSetupDoneCookie(response, value);
    return response;
  });
}
