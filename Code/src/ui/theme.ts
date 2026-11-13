import type { NextResponse } from "next/server";

/**
 * Presentation-only appearance preference. Never used for authentication
 * or authorization. Independent of `gc_ui_locale`.
 */
export const UI_THEME_COOKIE = "gc_ui_theme";

export const APP_THEMES = ["light", "dark", "system"] as const;

export type UiTheme = (typeof APP_THEMES)[number];

export type ResolvedColorScheme = "light" | "dark";

/** Product default. Unauthenticated and first-run UI start here. */
export const DEFAULT_THEME: UiTheme = "light";

export function isUiTheme(value: string | null | undefined): value is UiTheme {
  return value === "light" || value === "dark" || value === "system";
}

export function parseUiTheme(value: string | null | undefined): UiTheme | null {
  return isUiTheme(value) ? value : null;
}

/** Root layout / public HTML: cookie, else Light. No database. No auth. */
export function resolveHtmlTheme(cookieValue: string | null | undefined): UiTheme {
  return parseUiTheme(cookieValue) ?? DEFAULT_THEME;
}

/**
 * SSR can resolve light/dark immediately. `system` stays `system` until the
 * blocking bootstrap script reads `prefers-color-scheme`.
 */
export function ssrColorScheme(theme: UiTheme): ResolvedColorScheme | "system" {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return "system";
}

export function uiThemeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  };
}

export function applyUiThemeCookie(response: NextResponse, theme: UiTheme): void {
  response.cookies.set(UI_THEME_COOKIE, theme, uiThemeCookieOptions());
}

export function clearUiThemeCookie(response: NextResponse): void {
  response.cookies.set(UI_THEME_COOKIE, "", { ...uiThemeCookieOptions(), maxAge: 0 });
}
