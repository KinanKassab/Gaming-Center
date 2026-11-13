"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT } from "@/i18n/provider";
import { LanguageSwitcher } from "@/app/admin/_components/language-switcher";
import { ThemeSwitcher } from "@/app/_components/theme-switcher";
import {
  BETTER_AUTH_EMAIL_SIGN_IN_PATH,
  BETTER_AUTH_EMAIL_SIGN_UP_HTTP_METHOD,
  BETTER_AUTH_EMAIL_SIGN_UP_PATH,
  SETUP_BOOTSTRAP_TOKEN_HEADER,
  SETUP_FORM_NATIVE_ACTION,
  SETUP_FORM_NATIVE_METHOD,
} from "@/auth/setup-form-safety";

async function postJson(
  path: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const response = await fetch(path, {
    method: BETTER_AUTH_EMAIL_SIGN_UP_HTTP_METHOD,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { message?: string; error?: { message?: string } }
    | null;
  return payload?.error?.message ?? payload?.message ?? `Request failed (${response.status})`;
}

export function SetupForm() {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = (data.get("email") as string).trim();
    const password = data.get("password") as string;
    const name = (data.get("name") as string).trim();
    const bootstrapToken = (data.get("bootstrapToken") as string).trim();
    setBusy(true);
    setError(null);

    let failure = await postJson(
      BETTER_AUTH_EMAIL_SIGN_UP_PATH,
      { email, password, name },
      { [SETUP_BOOTSTRAP_TOKEN_HEADER]: bootstrapToken },
    );
    if (!failure) {
      failure = await postJson(BETTER_AUTH_EMAIL_SIGN_IN_PATH, { email, password });
    }

    setBusy(false);
    if (failure) {
      setError(failure);
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
        <h1>{t("setup.title")}</h1>
        <p>{t("setup.body")}</p>
        <form
          className="stack"
          method={SETUP_FORM_NATIVE_METHOD}
          action={SETUP_FORM_NATIVE_ACTION}
          onSubmit={onSubmit}
        >
          <noscript>
            <p className="error">{t("setup.javascriptRequired")}</p>
          </noscript>
          <label>
            {t("setup.displayName")}
            <input name="name" type="text" required maxLength={200} autoComplete="name" />
          </label>
          <label>
            {t("setup.email")}
            <input name="email" type="email" required maxLength={320} autoComplete="username" />
          </label>
          <label>
            {t("setup.password")}
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <label>
            {t("setup.bootstrapToken")}
            <input
              name="bootstrapToken"
              type="password"
              required
              minLength={16}
              autoComplete="off"
            />
            <span className="hint">{t("setup.bootstrapHint")}</span>
          </label>
          <button
            type="submit"
            formMethod={SETUP_FORM_NATIVE_METHOD}
            formAction={SETUP_FORM_NATIVE_ACTION}
            disabled={busy}
          >
            {busy ? t("common.working") : t("setup.submit")}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
