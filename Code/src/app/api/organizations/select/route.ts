import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthorizationError } from "@/core/errors";
import { resolveOrganizationContext } from "@/auth/context";
import { activateInvitedMembership, getOrganizationProfile, listUserMemberships } from "@/modules/identity";
import {
  ORGANIZATION_COOKIE,
  handleMutation,
  organizationCookieOptions,
  parseJsonBody,
  requireAuthenticated,
  uuidStringSchema,
} from "@/app/api/_lib/handler";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/locales";
import {
  UI_LOCALE_SOURCE_COOKIE,
  applyUiLocaleCookies,
  parseUiLocaleSource,
  readCookieFromHeader,
  shouldReplaceInheritedLocale,
} from "@/i18n/cookie";

const selectInputSchema = z.object({ organizationId: uuidStringSchema });

/**
 * Switch the current organization. The requested id must match one of the
 * authenticated user's own memberships; an INVITED membership is activated
 * here (self-consent). The cookie is set only after full validation.
 */
export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireAuthenticated();
    const input = selectInputSchema.parse(await parseJsonBody(request));

    const memberships = await listUserMemberships(db, context.user.id);
    const membership = memberships.find((row) => row.organizationId === input.organizationId);
    if (!membership) {
      throw new AuthorizationError("No access to this organization");
    }
    if (membership.status === "INVITED") {
      await activateInvitedMembership(db, context.user.id, input.organizationId);
    }

    const organizationContext = await resolveOrganizationContext(db, context, input.organizationId);
    const profile = await getOrganizationProfile(db, organizationContext.actor);

    const response = NextResponse.json({
      data: {
        organization: organizationContext.organization,
        permissions: organizationContext.actor.permissions,
        branchAccess: organizationContext.actor.branchAccess,
      },
    });
    response.cookies.set(ORGANIZATION_COOKIE, input.organizationId, organizationCookieOptions());
    const source = parseUiLocaleSource(
      readCookieFromHeader(request.headers.get("cookie"), UI_LOCALE_SOURCE_COOKIE),
    );
    if (shouldReplaceInheritedLocale(source) && isAppLocale(profile.locale)) {
      applyUiLocaleCookies(response, profile.locale, "org");
    } else if (shouldReplaceInheritedLocale(source)) {
      applyUiLocaleCookies(response, DEFAULT_LOCALE, "org");
    }
    return response;
  });
}
