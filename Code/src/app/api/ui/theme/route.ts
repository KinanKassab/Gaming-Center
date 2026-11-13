import { NextResponse } from "next/server";
import { z } from "zod";
import { applyUiThemeCookie, isUiTheme } from "@/ui/theme";
import { handleMutation, parseJsonBody } from "@/app/api/_lib/handler";

const inputSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
});

/**
 * Presentation preference only. Never used for authentication or authorization.
 * Does not require a session. Cookie is HttpOnly / SameSite=Lax / Path=/ /
 * Secure in production. Independent of language cookies.
 */
export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const input = inputSchema.parse(await parseJsonBody(request));
    if (!isUiTheme(input.theme)) {
      return NextResponse.json({ error: { message: "Invalid theme" } }, { status: 400 });
    }
    const response = NextResponse.json({ data: { theme: input.theme } });
    applyUiThemeCookie(response, input.theme);
    return response;
  });
}
