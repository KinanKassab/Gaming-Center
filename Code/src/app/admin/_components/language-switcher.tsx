"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { localeDir, type AppLocale } from "@/i18n/locales";
import { useLocale, useT } from "@/i18n/provider";

export function LanguageSwitcher(props: { variant?: "full" | "compact" | "icon" }) {
  const t = useT();
  const current = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const variant = props.variant ?? "full";

  async function onChange(next: AppLocale) {
    setBusy(true);
    setError(null);
    document.documentElement.lang = next;
    document.documentElement.dir = localeDir(next);
    const response = await fetch("/api/ui/locale", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next, source: "user" }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(t("common.error"));
      return;
    }
    router.refresh();
  }

  const controlId = useId();
  const hintId = useId();

  const select = (
    <select
      value={current}
      disabled={busy}
      aria-label={t("settings.language")}
      onChange={(event) => void onChange(event.target.value as AppLocale)}
    >
      <option value="ar">{t("org.languageArabic")}</option>
      <option value="en">{t("org.languageEnglish")}</option>
    </select>
  );

  if (variant === "icon") {
    const next = current === "ar" ? "en" : "ar";
    return (
      <span className="topbar-pref">
        <button
          type="button"
          className="icon-btn topbar-lang-btn"
          disabled={busy}
          aria-label={`${t("settings.language")}: ${current === "ar" ? t("org.languageArabic") : t("org.languageEnglish")}`}
          onClick={() => void onChange(next)}
        >
          {current === "ar" ? "EN" : "ع"}
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
      <label htmlFor={controlId}>{t("settings.language")}</label>
      <select
        id={controlId}
        value={current}
        disabled={busy}
        aria-describedby={hintId}
        onChange={(event) => void onChange(event.target.value as AppLocale)}
      >
        <option value="ar">{t("org.languageArabic")}</option>
        <option value="en">{t("org.languageEnglish")}</option>
      </select>
      <span className="hint" id={hintId}>
        {t("settings.languageHelp")}
      </span>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
