import { getRequestLocale } from "@/i18n/resolve";
import { t } from "@/i18n/t";
import { SignOutButton } from "@/app/admin/_components/controls";
import { LanguageSwitcher } from "@/app/admin/_components/language-switcher";
import { ThemeSwitcher } from "@/app/_components/theme-switcher";
import { HardRedirect } from "@/app/_components/hard-redirect";
import { loadSessionCoreUser } from "@/auth/context";
import { getSafeRuntimeDb } from "@/db/client";
import { getSafeAuth } from "@/auth/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AccessRevokedPage() {
  const locale = await getRequestLocale();
  const requestHeaders = new Headers(await headers());
  const db = await getSafeRuntimeDb();
  const auth = await getSafeAuth();
  const user = await loadSessionCoreUser(db, auth, requestHeaders);
  if (user?.status === "ACTIVE") {
    return <HardRedirect href="/admin" />;
  }

  return (
    <div className="auth-shell access-revoked-shell">
      <div className="auth-card access-revoked-card">
        <div className="auth-card-prefs">
          <LanguageSwitcher variant="compact" />
          <ThemeSwitcher variant="compact" />
        </div>
        <div className="access-revoked-mark" aria-hidden="true">
          ⊘
        </div>
        <h1>{t(locale, "accessRevoked.title")}</h1>
        <p>{t(locale, "accessRevoked.body")}</p>
        <p className="hint">{t(locale, "accessRevoked.hint")}</p>
        {user ? (
          <SignOutButton />
        ) : (
          <p>
            <a href="/login">{t(locale, "accessRevoked.signIn")}</a>
          </p>
        )}
      </div>
    </div>
  );
}
