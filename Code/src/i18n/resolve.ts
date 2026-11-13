import { cookies } from "next/headers";
import { UI_LOCALE_COOKIE, resolveHtmlLocale } from "@/i18n/cookie";
import type { AppLocale } from "@/i18n/locales";

/** Cookie only. Root layout must not query the database for lang/dir. */
export async function getRequestLocale(): Promise<AppLocale> {
  const store = await cookies();
  return resolveHtmlLocale(store.get(UI_LOCALE_COOKIE)?.value);
}
