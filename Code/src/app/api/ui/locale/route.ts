import { NextResponse } from "next/server";
import { z } from "zod";
import { applyUiLocaleCookies } from "@/i18n/cookie";
import { isAppLocale } from "@/i18n/locales";
import { handleMutation, parseJsonBody } from "@/app/api/_lib/handler";

const inputSchema = z.object({
  locale: z.enum(["ar", "en"]),
  source: z.enum(["user", "org"]).optional(),
});

/**
 * Presentation preference only. Never used for authentication or authorization.
 * Does not require a session (public login/setup must be able to choose Arabic/English).
 * Cookie is HttpOnly / SameSite=Lax / Path=/ / Secure in production.
 * source=user is a personal override; source=org inherits the business default.
 * This route does not write core_organizations.locale.
 */
export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const input = inputSchema.parse(await parseJsonBody(request));
    if (!isAppLocale(input.locale)) {
      return NextResponse.json({ error: { message: "Invalid locale" } }, { status: 400 });
    }
    const source = input.source ?? "user";
    const response = NextResponse.json({ data: { locale: input.locale, source } });
    applyUiLocaleCookies(response, input.locale, source);
    return response;
  });
}
