import { describe, expect, it } from "vitest";
import { displayApiError, displayCheckoutReason } from "@/i18n/api-error";

describe("BUG-009 API/domain error display", () => {
  it("maps known checkout reasons to Arabic and English without leaking the other locale", () => {
    const cases = [
      ["guest_must_pay_in_full", "يجب دفع جلسات الزائر بالكامل", "Guest sessions must be paid in full"],
      ["payment_amount_not_positive", "يجب أن يكون مبلغ الدفع أكبر من صفر", "Payment amount must be greater than zero"],
      ["payment_exceeds_remaining", "المبلغ أكبر من المتبقي", "Payment exceeds remaining amount due"],
      ["invalid_input", "إدخال غير صالح", "Invalid input"],
      ["branch_name_in_use", "يوجد فرع بهذا الاسم في هذا النشاط", "A branch with this name already exists in this organization"],
      ["device_required", "اختر جهازاً", "Select a device"],
      ["device_type_required", "اختر نوع جهاز", "Select a device type"],
      ["device_hourly_exists", "لهذا الجهاز سعر ساعة بالفعل", "This device already has an hourly price"],
      ["device_type_hourly_exists", "لهذا النوع سعر ساعة بالفعل", "This device type already has an hourly price"],
    ] as const;
    for (const [reason, arabic, english] of cases) {
      expect(displayApiError({ reason }, "ar")).toBe(arabic);
      expect(displayApiError({ reason }, "en")).toBe(english);
      expect(displayApiError({ reason }, "ar")).not.toBe(english);
    }
  });

  it("uses a safe Arabic fallback instead of raw English when the reason is unknown", () => {
    const failure = {
      reason: "totally.unknown.reason",
      message: "Guest sessions must be paid in full",
    };
    const arabic = displayApiError(failure, "ar");
    expect(arabic).toBe("حدث خطأ");
    expect(arabic).not.toMatch(/Guest|Payment|Invalid|SQL|postgres/i);
    expect(displayApiError(failure, "en")).toBe("Guest sessions must be paid in full");
  });

  it("does not show stack traces or SQL in either locale", () => {
    const failure = {
      message: "insert into finance_payments failed\n    at checkout.ts:12",
    };
    expect(displayApiError(failure, "ar")).toBe("حدث خطأ");
    expect(displayApiError(failure, "en")).toBe("Something went wrong");
  });

  it("localizes checkout ineligible reasons", () => {
    expect(displayCheckoutReason("OPEN_SESSION", "ar")).toBe("أنهِ الجلسة قبل التحصيل");
    expect(displayCheckoutReason("OPEN_SESSION", "en")).toBe("End the session before checkout");
  });
});
