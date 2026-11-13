import type { AppLocale } from "@/i18n/locales";
import { t } from "@/i18n/t";

/** Better Auth email sign-in codes that mean “wrong email or password”. */
const CREDENTIAL_CODES = new Set([
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_PASSWORD",
  "USER_NOT_FOUND",
  "INVALID_EMAIL",
]);

export type LoginFailurePayload = {
  code?: string | null;
  message?: string | null;
  error?: { code?: string | null; message?: string | null } | null;
} | null;

function extractCode(payload: LoginFailurePayload): string {
  const nested = payload?.error?.code?.trim() ?? "";
  if (nested) return nested;
  return payload?.code?.trim() ?? "";
}

/**
 * Map Better Auth / HTTP sign-in failures to catalog copy.
 * Do not surface raw provider messages, stacks, or SQL.
 */
export function displayLoginError(
  input: { status: number; payload?: LoginFailurePayload },
  locale: AppLocale,
): string {
  const code = extractCode(input.payload ?? null);
  if (code && CREDENTIAL_CODES.has(code)) {
    return t(locale, "login.invalidCredentials");
  }
  if (input.status === 401 || input.status === 403) {
    return t(locale, "login.invalidCredentials");
  }
  if (!Number.isFinite(input.status) || input.status <= 0) {
    return t(locale, "apiError.unknown");
  }
  return t(locale, "login.failed", { status: input.status });
}
