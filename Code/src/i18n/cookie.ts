import type { NextResponse } from "next/server";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale, type LocaleSource } from "@/i18n/locales";

/**
 * Presentation-only cookies. Never used for authentication or authorization.
 * Set only from server route handlers (not from document.cookie).
 */
export const UI_LOCALE_COOKIE = "gc_ui_locale";
export const UI_LOCALE_SOURCE_COOKIE = "gc_ui_locale_source";

export function uiLocaleCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  };
}

export function parseUiLocale(value: string | null | undefined): AppLocale | null {
  return isAppLocale(value) ? value : null;
}

export function parseUiLocaleSource(value: string | null | undefined): LocaleSource | null {
  return value === "user" || value === "org" ? value : null;
}

/** Root layout / public HTML: cookie, else Arabic. No database. */
export function resolveHtmlLocale(cookieValue: string | null | undefined): AppLocale {
  return parseUiLocale(cookieValue) ?? DEFAULT_LOCALE;
}

/** Inherit org default unless the user explicitly overrode language in Settings. */
export function shouldReplaceInheritedLocale(source: LocaleSource | null): boolean {
  return source !== "user";
}

export function applyUiLocaleCookies(
  response: NextResponse,
  locale: AppLocale,
  source: LocaleSource,
): void {
  const options = uiLocaleCookieOptions();
  response.cookies.set(UI_LOCALE_COOKIE, locale, options);
  response.cookies.set(UI_LOCALE_SOURCE_COOKIE, source, options);
}

export function clearUiLocaleCookies(response: NextResponse): void {
  const options = { ...uiLocaleCookieOptions(), maxAge: 0 };
  response.cookies.set(UI_LOCALE_COOKIE, "", options);
  response.cookies.set(UI_LOCALE_SOURCE_COOKIE, "", options);
}

export function readCookieFromHeader(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return undefined;
}
