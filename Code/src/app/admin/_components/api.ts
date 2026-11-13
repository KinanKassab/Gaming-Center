import { displayApiError } from "@/i18n/api-error";
import type { AppLocale } from "@/i18n/locales";

export type ApiResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; message: string; status: number; code?: string; reason?: string };

export function apiErrorText(result: Extract<ApiResult, { ok: false }>, locale: AppLocale): string {
  return displayApiError(result, locale);
}

export async function apiRequest(
  path: string,
  options: { method: string; body?: unknown; headers?: Record<string, string> },
): Promise<ApiResult> {
  const headers = new Headers(options.headers);
  const init: RequestInit = { method: options.method, headers };
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string; code?: string; reason?: string };
    warnings?: unknown;
  } | null;
  if (response.ok) {
    return { ok: true, status: response.status, body: payload };
  }
  return {
    ok: false,
    status: response.status,
    message: payload?.error?.message ?? `Request failed (${response.status})`,
    ...(payload?.error?.code ? { code: payload.error.code } : {}),
    ...(payload?.error?.reason ? { reason: payload.error.reason } : {}),
  };
}
