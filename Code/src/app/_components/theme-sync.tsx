"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { UiTheme } from "@/ui/theme";

const ThemePrefContext = createContext<UiTheme>("light");

function applyResolvedScheme() {
  const root = document.documentElement;
  const pref = root.getAttribute("data-ui-theme") || "light";
  const resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref === "dark"
        ? "dark"
        : "light";
  root.setAttribute("data-color-scheme", resolved);
  root.style.colorScheme = resolved;
}

export function ThemeProvider(props: { theme: UiTheme; children: ReactNode }) {
  useEffect(() => {
    applyResolvedScheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      if (document.documentElement.getAttribute("data-ui-theme") === "system") {
        applyResolvedScheme();
      }
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [props.theme]);
  return <ThemePrefContext.Provider value={props.theme}>{props.children}</ThemePrefContext.Provider>;
}

export function useUiThemePreference(): UiTheme {
  return useContext(ThemePrefContext);
}

export function applyUiThemeAttribute(theme: UiTheme) {
  document.documentElement.setAttribute("data-ui-theme", theme);
  applyResolvedScheme();
}
