/**
 * Checkout presentation for the guest full-payment rule.
 * Does not change payment eligibility or guest_must_pay_in_full enforcement.
 */

export type GuestPayNoticeKind = "must_pay" | "paid" | null;

export function guestPayNoticeKind(input: {
  guestMustPayInFull: boolean;
  settlementStatus: string | null | undefined;
}): GuestPayNoticeKind {
  if (!input.guestMustPayInFull) return null;
  if (input.settlementStatus === "PAID") return "paid";
  return "must_pay";
}
