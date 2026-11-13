import { cookies } from "next/headers";
import { UI_THEME_COOKIE, resolveHtmlTheme, type UiTheme } from "@/ui/theme";

/** Cookie only. Root layout must not query the database for theme. */
export async function getRequestTheme(): Promise<UiTheme> {
  const store = await cookies();
  return resolveHtmlTheme(store.get(UI_THEME_COOKIE)?.value);
}
