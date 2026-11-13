import Link from "next/link";
import { authenticatedEntryHref } from "@/auth/entry";
import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import { LanguageSwitcher } from "@/app/admin/_components/language-switcher";
import { ThemeSwitcher } from "@/app/_components/theme-switcher";
import { HardRedirect } from "@/app/_components/hard-redirect";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const entry = await authenticatedEntryHref();
  if (entry) return <HardRedirect href={entry} />;
  const locale = await getRequestLocale();
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card-prefs">
          <LanguageSwitcher variant="compact" />
          <ThemeSwitcher variant="compact" />
        </div>
        <h1>{t(locale, "home.title")}</h1>
        <p>{t(locale, "home.body")}</p>
        <p>
          <Link href="/login">{t(locale, "home.signIn")}</Link>
        </p>
      </div>
    </div>
  );
}
