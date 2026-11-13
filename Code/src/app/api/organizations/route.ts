import { NextResponse } from "next/server";
import {
  assertInitialOrganizationCreateAllowed,
  createOrganization,
  createOrganizationInputSchema,
  runWithPlatformOrganizationClaim,
} from "@/modules/identity";
import {
  ORGANIZATION_COOKIE,
  handleMutation,
  organizationCookieOptions,
  parseJsonBody,
  requireAuthenticated,
} from "@/app/api/_lib/handler";
import {
  UI_LOCALE_SOURCE_COOKIE,
  applyUiLocaleCookies,
  parseUiLocaleSource,
  readCookieFromHeader,
} from "@/i18n/cookie";

/** Initial organization only. Further tenants are NEEDS DECISION (platform-admin). */
export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireAuthenticated();
    await assertInitialOrganizationCreateAllowed(db);
    const input = createOrganizationInputSchema.parse(await parseJsonBody(request));
    const created = await runWithPlatformOrganizationClaim(() =>
      createOrganization(db, { userId: context.user.id }, input),
    );

    const response = NextResponse.json({ data: created }, { status: 201 });
    response.cookies.set(ORGANIZATION_COOKIE, created.organizationId, organizationCookieOptions());
    const existingSource = parseUiLocaleSource(
      readCookieFromHeader(request.headers.get("cookie"), UI_LOCALE_SOURCE_COOKIE),
    );
    applyUiLocaleCookies(response, input.locale, existingSource === "user" ? "user" : "org");
    return response;
  });
}
