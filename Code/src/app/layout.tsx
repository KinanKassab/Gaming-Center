import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { DM_Sans, Noto_Sans_Arabic } from "next/font/google";
import { getRequestLocale } from "@/i18n/resolve";
import { localeDir } from "@/i18n/locales";
import { I18nProvider } from "@/i18n/provider";
import { t } from "@/i18n/t";
import { getRequestTheme } from "@/ui/resolve-theme";
import { ssrColorScheme } from "@/ui/theme";
import { THEME_BOOTSTRAP_SCRIPT } from "@/ui/theme-script";
import { ThemeProvider } from "@/app/_components/theme-sync";
import { ToastProvider } from "@/app/_components/feedback";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

const notoArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-noto-arabic",
});

/** postgres.js needs Node TCP. Do not run this app on the Edge runtime. */
export const runtime = "nodejs";

/** Colocate with Ireland / eu-west-1 Supabase. */
export const preferredRegion = ["dub1"];

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: t(locale, "brand"),
    description: t(locale, "home.body"),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  const theme = await getRequestTheme();
  const colorScheme = ssrColorScheme(theme);
  return (
    <html
      lang={locale}
      dir={localeDir(locale)}
      className={`${dmSans.variable} ${notoArabic.variable}`}
      data-ui-theme={theme}
      {...(colorScheme === "system" ? {} : { "data-color-scheme": colorScheme })}
      suppressHydrationWarning
    >
      <body>
        <Script id="gc-ui-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <I18nProvider locale={locale}>
          <ThemeProvider theme={theme}>
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
