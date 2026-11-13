"use client";

import { useId, useState } from "react";
import { useT } from "@/i18n/provider";
import { applyUiThemeAttribute, useUiThemePreference } from "@/app/_components/theme-sync";
import { IconMoon, IconSun, IconSystem } from "@/app/_components/icons";
import type { UiTheme } from "@/ui/theme";

const THEME_ORDER: UiTheme[] = ["light", "dark", "system"];

export function ThemeSwitcher(props: { variant?: "full" | "compact" | "icon" }) {
  const t = useT();
  const variant = props.variant ?? "full";
  const controlId = useId();
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialTheme = useUiThemePreference();
  const [value, setValue] = useState<UiTheme>(initialTheme);

  async function onChange(next: UiTheme) {
    setBusy(true);
    setError(null);
    applyUiThemeAttribute(next);
    setValue(next);
    const response = await fetch("/api/ui/theme", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(t("common.error"));
    }
  }

  const themeLabel =
    value === "dark" ? t("ui.themeDark") : value === "system" ? t("ui.themeSystem") : t("ui.themeLight");

  const select = (
    <select
      value={value}
      disabled={busy}
      aria-label={t("ui.theme")}
      onChange={(event) => void onChange(event.target.value as UiTheme)}
    >
      <option value="light">{t("ui.themeLight")}</option>
      <option value="dark">{t("ui.themeDark")}</option>
      <option value="system">{t("ui.themeSystem")}</option>
    </select>
  );

  if (variant === "icon") {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(value) + 1) % THEME_ORDER.length] ?? "light";
    const Icon = value === "dark" ? IconMoon : value === "system" ? IconSystem : IconSun;
    return (
      <span className="topbar-pref">
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          aria-label={`${t("ui.theme")}: ${themeLabel}`}
          onClick={() => void onChange(next)}
        >
          <Icon />
        </button>
        {error ? <span className="error">{error}</span> : null}
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span className="topbar-pref">
        {select}
        {error ? <span className="error">{error}</span> : null}
      </span>
    );
  }

  return (
    <div className="form-field">
      <label htmlFor={controlId}>{t("ui.theme")}</label>
      <select
        id={controlId}
        value={value}
        disabled={busy}
        aria-describedby={hintId}
        onChange={(event) => void onChange(event.target.value as UiTheme)}
      >
        <option value="light">{t("ui.themeLight")}</option>
        <option value="dark">{t("ui.themeDark")}</option>
        <option value="system">{t("ui.themeSystem")}</option>
      </select>
      <span className="hint" id={hintId}>
        {t("ui.themeHelp")}
      </span>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
