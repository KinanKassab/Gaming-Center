import type { AppLocale } from "@/i18n/locales";
import { t, type MessageKey } from "@/i18n/t";

const REASON_KEYS = {
  invalid_input: "apiError.invalidInput",
  guest_must_pay_in_full: "apiError.guestMustPayInFull",
  payment_amount_not_positive: "apiError.paymentAmountNotPositive",
  expense_amount_not_positive: "apiError.expenseAmountNotPositive",
  expense_currency_mismatch: "apiError.expenseCurrencyMismatch",
  payment_exceeds_remaining: "apiError.paymentExceedsRemaining",
  payment_currency_mismatch: "apiError.paymentCurrencyMismatch",
  unsupported_payment_method: "apiError.unsupportedPaymentMethod",
  payment_reference_required: "apiError.paymentReferenceRequired",
  bill_already_settled: "apiError.billAlreadySettled",
  branch_name_in_use: "apiError.branchNameInUse",
  device_required: "apiError.deviceRequired",
  device_type_required: "apiError.deviceTypeRequired",
  hourly_price_not_positive: "apiError.hourlyPriceNotPositive",
  device_hourly_exists: "apiError.deviceHourlyExists",
  device_type_hourly_exists: "apiError.deviceTypeHourlyExists",
  device_type_in_use: "apiError.deviceTypeInUse",
  cannot_modify_self: "apiError.cannotModifySelf",
  offer_needs_name: "apiError.offerNeedsName",
  offer_needs_duration: "apiError.offerNeedsDuration",
  CANCELLED_SESSION: "apiError.cancelledSession",
  OPEN_SESSION: "apiError.openSession",
  NOT_COMPLETED: "apiError.notCompleted",
  BILLING_NOT_FINALIZED: "apiError.billingNotFinalized",
} as const satisfies Record<string, MessageKey>;

const CODE_KEYS = {
  INVALID_INPUT: "apiError.invalidInput",
  UNAUTHENTICATED: "apiError.unauthenticated",
  FORBIDDEN: "apiError.forbidden",
  NOT_FOUND: "apiError.notFound",
  CONFLICT: "apiError.conflict",
  INTERNAL: "apiError.internal",
} as const satisfies Record<string, MessageKey>;

export type DisplayableApiFailure = {
  reason?: string | null;
  code?: string | null;
  message?: string | null;
};

function looksUnsafeToShow(message: string): boolean {
  return /sql|stack|\bat \S+|postgres|drizzle|organization_id|constraint|\binsert\b|\bselect\b|\bupdate\b|\bdelete from\b/i.test(
    message,
  );
}

export function displayApiError(failure: DisplayableApiFailure, locale: AppLocale): string {
  const reason = failure.reason?.trim() ?? "";
  if (reason && reason in REASON_KEYS) {
    return t(locale, REASON_KEYS[reason as keyof typeof REASON_KEYS]);
  }
  const code = failure.code?.trim() ?? "";
  if (code && code in CODE_KEYS) {
    return t(locale, CODE_KEYS[code as keyof typeof CODE_KEYS]);
  }
  const message = failure.message?.trim() ?? "";
  if (message && !looksUnsafeToShow(message) && locale === "en") {
    return message;
  }
  return t(locale, "apiError.unknown");
}

export function displayCheckoutReason(reason: string | null | undefined, locale: AppLocale): string | null {
  if (!reason) return null;
  if (reason in REASON_KEYS) {
    return t(locale, REASON_KEYS[reason as keyof typeof REASON_KEYS]);
  }
  return displayApiError({ reason, code: "CONFLICT" }, locale);
}
