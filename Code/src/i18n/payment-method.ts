import type { AppLocale } from "@/i18n/locales";
import { t } from "@/i18n/t";

/** Stored payment method codes. Do not change these values. */
export const PAYMENT_METHOD_CASH = "CASH";
export const PAYMENT_METHOD_SHAMCASH = "SHAMCASH";

export function paymentMethodLabel(
  code: string,
  locale: AppLocale,
  fallbackName?: string | null,
): string {
  if (code === PAYMENT_METHOD_CASH) return t(locale, "checkout.cash");
  if (code === PAYMENT_METHOD_SHAMCASH) return t(locale, "checkout.shamcash");
  const name = fallbackName?.trim();
  return name && name.length > 0 ? name : code;
}
