"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LanguageSwitcher } from "@/app/admin/_components/language-switcher";
import { ThemeSwitcher } from "@/app/_components/theme-switcher";
import {
  BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD,
  BETTER_AUTH_EMAIL_SIGN_IN_PATH,
  LOGIN_FORM_NATIVE_ACTION,
  LOGIN_FORM_NATIVE_METHOD,
} from "@/auth/login-form-safety";
import { displayLoginError } from "@/i18n/login-error";
import { useLocale, useT } from "@/i18n/provider";

async function postSignIn(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: BETTER_AUTH_EMAIL_SIGN_IN_HTTP_METHOD,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { code?: string; message?: string; error?: { code?: string; message?: string } }
    | null;
  return { status: response.status, payload };
}

export function LoginForm({ firstUserRequired }: { firstUserRequired: boolean }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [failure, setFailure] = useState<{
    status: number;
    payload: { code?: string; message?: string; error?: { code?: string; message?: string } } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const error = failure ? displayLoginError(failure, locale) : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = (data.get("email") as string).trim();
    const password = data.get("password") as string;
    setBusy(true);
    setFailure(null);
    const result = await postSignIn(BETTER_AUTH_EMAIL_SIGN_IN_PATH, { email, password });
    setBusy(false);
    if (result) {
      setFailure(result);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card-prefs">
          <LanguageSwitcher variant="compact" />
          <ThemeSwitcher variant="compact" />
        </div>
        <h1>{t("login.title")}</h1>
        <p>{t("login.body")}</p>
        <form
          className="stack"
          method={LOGIN_FORM_NATIVE_METHOD}
          action={LOGIN_FORM_NATIVE_ACTION}
          onSubmit={onSubmit}
        >
          <noscript>
            <p className="error">{t("login.javascriptRequired")}</p>
          </noscript>
          <label>
            {t("login.email")}
            <input name="email" type="email" required maxLength={320} autoComplete="username" />
          </label>
          <label>
            {t("login.password")}
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          <button
            type="submit"
            formMethod={LOGIN_FORM_NATIVE_METHOD}
            formAction={LOGIN_FORM_NATIVE_ACTION}
            disabled={busy}
          >
            {busy ? t("login.submitting") : t("login.submit")}
          </button>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </form>
        {firstUserRequired ? (
          <p>
            <Link href="/setup">{t("login.firstOwner")}</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
