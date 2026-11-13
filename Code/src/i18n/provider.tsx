"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";
import { t, type MessageKey } from "@/i18n/t";

const LocaleContext = createContext<AppLocale>(DEFAULT_LOCALE);

export function I18nProvider(props: { locale: AppLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={props.locale}>{props.children}</LocaleContext.Provider>;
}

export function useLocale(): AppLocale {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();
  return (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}
