import { localeDir, type AppLocale } from "@/i18n/locales";

/** Viewport at which the sidebar becomes a drawer (tablet and phone). */
export const SHELL_COMPACT_MAX_PX = 1100;

/** Viewport at which the mobile bottom nav appears. */
export const SHELL_BOTTOM_NAV_MAX_PX = 720;

/**
 * Single direction strategy for the admin shell (BUG-001 / BUG-002).
 *
 * Document `dir` on `<html>` is the only placement mechanism.
 * The grid is always: sidebar track, then workspace.
 * Logical inset (inline-start) opens the compact drawer from the start edge.
 * Do not also swap CSS grid columns by locale — that double-compensates RTL.
 */
export function shellDocumentDir(locale: AppLocale): "rtl" | "ltr" {
  return localeDir(locale);
}

/** Physical side of the persistent desktop sidebar. Follows html `dir` only. */
export function desktopSidebarPhysicalSide(dir: "rtl" | "ltr"): "left" | "right" {
  return dir === "rtl" ? "right" : "left";
}

export function isCompactNavViewport(widthPx: number): boolean {
  return widthPx <= SHELL_COMPACT_MAX_PX;
}

export function showsBottomNav(widthPx: number): boolean {
  return widthPx <= SHELL_BOTTOM_NAV_MAX_PX;
}

/** Compact icon prefs in the topbar (hamburger + drawer viewports). */
export function usesCompactTopbarControls(widthPx: number): boolean {
  return isCompactNavViewport(widthPx);
}

/**
 * Extra padding below page content when the bottom nav is visible (BUG-016).
 * Matches `--shell-content-bottom-clearance` in globals.css.
 * The nav itself stays in document flow; this keeps last actions above the thumb/home indicator.
 */
export const SHELL_CONTENT_BOTTOM_CLEARANCE_CSS =
  "calc(var(--space-5) + env(safe-area-inset-bottom, 0px))";

export function checkoutHistoryLayout(widthPx: number): "table" | "cards" {
  return showsBottomNav(widthPx) ? "cards" : "table";
}
