"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DEFAULT_LOCALE, localeDir, type AppLocale } from "@/i18n/locales";
import { detectBrowserTimeZone } from "@/i18n/timezone";
import { useT, useLocale } from "@/i18n/provider";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";

export function CreateOrganizationForm() {
  const t = useT();
  const displayLocale = useLocale();
  const router = useRouter();
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_LOCALE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyLocalePreview(next: AppLocale) {
    setLocale(next);
    document.documentElement.lang = next;
    document.documentElement.dir = localeDir(next);
    await fetch("/api/ui/locale", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next, source: "org" }),
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/organizations", {
      method: "POST",
      body: {
        name: String(data.get("name") ?? ""),
        defaultCurrency: String(data.get("defaultCurrency") ?? "SYP"),
        locale,
        timezone: detectBrowserTimeZone(),
      },
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(apiErrorText(result, displayLocale));
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label>
        {t("org.name")}
        <input name="name" required maxLength={200} placeholder={t("org.namePlaceholder")} />
      </label>
      <label>
        {t("org.currency")}
        <input name="defaultCurrency" defaultValue="SYP" required maxLength={3} />
      </label>
      <label>
        {t("org.language")}
        <select
          value={locale}
          onChange={(event) => void applyLocalePreview(event.target.value as AppLocale)}
        >
          <option value="ar">{t("org.languageArabic")}</option>
          <option value="en">{t("org.languageEnglish")}</option>
        </select>
      </label>
      <button type="submit" disabled={busy}>
        {busy ? t("common.working") : t("org.submit")}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
