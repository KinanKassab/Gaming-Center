export const APP_LOCALES = ["ar", "en"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

/** Product default. Unauthenticated and first-run UI start here. */
export const DEFAULT_LOCALE: AppLocale = "ar";

export type LocaleSource = "user" | "org";

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "ar" || value === "en";
}

export function localeDir(locale: AppLocale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function localeHtmlLang(locale: AppLocale): AppLocale {
  return locale;
}
