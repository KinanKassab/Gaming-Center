import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHELL_BOTTOM_NAV_MAX_PX,
  SHELL_COMPACT_MAX_PX,
  SHELL_CONTENT_BOTTOM_CLEARANCE_CSS,
  checkoutHistoryLayout,
  desktopSidebarPhysicalSide,
  isCompactNavViewport,
  shellDocumentDir,
  showsBottomNav,
  usesCompactTopbarControls,
} from "@/ui/shell-layout";

const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");

describe("admin shell layout (BUG-001 / BUG-002)", () => {
  it("uses html direction only: Arabic sidebar right, English sidebar left", () => {
    expect(shellDocumentDir("ar")).toBe("rtl");
    expect(shellDocumentDir("en")).toBe("ltr");
    expect(desktopSidebarPhysicalSide("rtl")).toBe("right");
    expect(desktopSidebarPhysicalSide("ltr")).toBe("left");
  });

  it("treats tablet and phone as compact drawers and reserves bottom nav for phone", () => {
    expect(isCompactNavViewport(390)).toBe(true);
    expect(isCompactNavViewport(900)).toBe(true);
    expect(isCompactNavViewport(1440)).toBe(false);
    expect(showsBottomNav(390)).toBe(true);
    expect(showsBottomNav(900)).toBe(false);
    expect(SHELL_COMPACT_MAX_PX).toBe(1100);
    expect(SHELL_BOTTOM_NAV_MAX_PX).toBe(720);
  });

  it("does not double-compensate RTL by swapping grid columns", () => {
    expect(css).toContain("grid-template-columns: var(--sidebar-w) minmax(0, 1fr)");
    expect(css).not.toContain("grid-template-columns: minmax(0, 1fr) var(--sidebar-w)");
    expect(css).not.toContain('.app-shell[data-dir="rtl"] .app-sidebar {\n  grid-column: 2;');
  });

  it("lets .app-sidebar.open win over the compact hide rule", () => {
    expect(css).toMatch(/\.app-sidebar\.open\s*\{[^}]*display:\s*flex/s);
    expect(css).not.toMatch(/\.app-shell\[data-dir="ltr"\] \.app-sidebar,\s*\n\s*\.app-shell\[data-dir="rtl"\] \.app-sidebar\s*\{[^}]*display:\s*none/s);
  });

  it("opens the compact drawer from inline-start so RTL uses the right edge", () => {
    expect(css).toMatch(/\.app-sidebar\.open\s*\{[^}]*inset-inline-start:\s*0/s);
  });
});

describe("mobile shell (BUG-016)", () => {
  it("uses compact icon topbar controls on drawer viewports and text controls on desktop", () => {
    expect(usesCompactTopbarControls(390)).toBe(true);
    expect(usesCompactTopbarControls(900)).toBe(true);
    expect(usesCompactTopbarControls(1366)).toBe(false);
    expect(css).toContain(".app-topbar-prefs-compact");
    expect(css).toMatch(/@media \(max-width: 1100px\)[\s\S]*\.app-topbar-prefs-desktop\s*\{\s*display:\s*none/s);
    expect(css).toMatch(/@media \(max-width: 1100px\)[\s\S]*\.app-topbar-prefs-compact\s*\{\s*display:\s*flex/s);
    expect(css).toMatch(/@media \(max-width: 1100px\)[\s\S]*\.app-topbar\s*\{[\s\S]*flex-wrap:\s*nowrap/s);
  });

  it("reserves shared bottom-nav content clearance instead of a Floor-only margin", () => {
    expect(showsBottomNav(390)).toBe(true);
    expect(showsBottomNav(900)).toBe(false);
    expect(SHELL_CONTENT_BOTTOM_CLEARANCE_CSS).toContain("safe-area-inset-bottom");
    expect(css).toContain("--shell-content-bottom-clearance");
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*--shell-content-bottom-clearance:\s*calc\(var\(--space-5\) \+ env\(safe-area-inset-bottom/s,
    );
    expect(css).toContain("padding-bottom: var(--shell-content-bottom-clearance)");
    expect(css).toContain("scroll-padding-bottom: var(--shell-content-bottom-clearance)");
  });

  it("presents checkout payment history as cards on a 390px phone and as a table on desktop", () => {
    expect(checkoutHistoryLayout(390)).toBe("cards");
    expect(checkoutHistoryLayout(900)).toBe("table");
    expect(checkoutHistoryLayout(1440)).toBe("table");
    expect(SHELL_BOTTOM_NAV_MAX_PX).toBe(720);
    expect(SHELL_COMPACT_MAX_PX).toBe(1100);
  });
});
