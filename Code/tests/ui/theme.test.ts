import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  parseUiTheme,
  resolveHtmlTheme,
  ssrColorScheme,
  uiThemeCookieOptions,
  UI_THEME_COOKIE,
} from "@/ui/theme";
import { THEME_BOOTSTRAP_SCRIPT } from "@/ui/theme-script";
import { UI_LOCALE_COOKIE } from "@/i18n/cookie";

describe("ui theme preference", () => {
  it("defaults to light and ignores unknown values", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(resolveHtmlTheme(undefined)).toBe("light");
    expect(parseUiTheme("dark")).toBe("dark");
    expect(parseUiTheme("system")).toBe("system");
    expect(parseUiTheme("light")).toBe("light");
    expect(parseUiTheme("nope")).toBeNull();
    expect(resolveHtmlTheme("nope")).toBe("light");
  });

  it("lets SSR resolve light and dark immediately and leaves system to the bootstrap script", () => {
    expect(ssrColorScheme("light")).toBe("light");
    expect(ssrColorScheme("dark")).toBe("dark");
    expect(ssrColorScheme("system")).toBe("system");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("data-ui-theme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("data-color-scheme");
  });

  it("sets a presentation cookie that is independent of locale and is not an auth cookie", () => {
    const options = uiThemeCookieOptions();
    expect(UI_THEME_COOKIE).toBe("gc_ui_theme");
    expect(UI_THEME_COOKIE).not.toBe(UI_LOCALE_COOKIE);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });
});
