import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { guestPayNoticeKind } from "@/ui/guest-checkout-notice";
import { t } from "@/i18n/t";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("BUG-023 guest checkout notice", () => {
  it("shows the full-pay instruction only while a guest bill is not settled", () => {
    expect(guestPayNoticeKind({ guestMustPayInFull: true, settlementStatus: "UNPAID" })).toBe("must_pay");
    expect(guestPayNoticeKind({ guestMustPayInFull: true, settlementStatus: "PARTIALLY_PAID" })).toBe("must_pay");
    expect(guestPayNoticeKind({ guestMustPayInFull: true, settlementStatus: "PAID" })).toBe("paid");
    expect(guestPayNoticeKind({ guestMustPayInFull: false, settlementStatus: "UNPAID" })).toBeNull();
    expect(guestPayNoticeKind({ guestMustPayInFull: false, settlementStatus: "PAID" })).toBeNull();
  });

  it("does not treat a paid guest bill as still owing", () => {
    const page = source("app/admin/gaming/sessions/[sessionId]/checkout/page.tsx");
    expect(page).toContain("guestPayNoticeKind");
    expect(page).toContain('guestNotice === "must_pay"');
    expect(page).toContain('guestNotice === "paid"');
    expect(page).not.toMatch(/checkout\.guestMustPayInFull \? <p>\{t\(locale, "checkout\.guestMustPay"\)\}/);
  });

  it("keeps unpaid and paid copy distinct in Arabic and English", () => {
    expect(t("en", "checkout.guestMustPay")).toMatch(/paid in full/i);
    expect(t("ar", "checkout.guestMustPay")).toContain("كاملة");
    expect(t("en", "checkout.guestPaid")).toMatch(/paid in full/i);
    expect(t("ar", "checkout.guestPaid")).toContain("مدفوعة");
    expect(t("en", "checkout.guestPaid")).not.toBe(t("en", "checkout.guestMustPay"));
    expect(t("ar", "checkout.guestPaid")).not.toBe(t("ar", "checkout.guestMustPay"));
  });
});
