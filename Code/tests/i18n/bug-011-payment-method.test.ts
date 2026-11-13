import { describe, expect, it } from "vitest";
import {
  PAYMENT_METHOD_CASH,
  PAYMENT_METHOD_SHAMCASH,
  paymentMethodLabel,
} from "@/i18n/payment-method";

describe("BUG-011 payment method display labels", () => {
  it("keeps stored method codes unchanged", () => {
    expect(PAYMENT_METHOD_CASH).toBe("CASH");
    expect(PAYMENT_METHOD_SHAMCASH).toBe("SHAMCASH");
  });

  it("renders localized labels from codes without using internal English names as Arabic", () => {
    expect(paymentMethodLabel("CASH", "en")).toBe("Cash");
    expect(paymentMethodLabel("SHAMCASH", "en")).toBe("ShamCash");
    expect(paymentMethodLabel("CASH", "ar")).toBe("نقد");
    expect(paymentMethodLabel("SHAMCASH", "ar")).toBe("شام كاش");
    expect(paymentMethodLabel("CASH", "ar")).not.toBe("Cash");
    expect(paymentMethodLabel("SHAMCASH", "ar")).not.toBe("ShamCash");
  });

  it("does not rewrite unknown codes", () => {
    expect(paymentMethodLabel("OTHER", "en", "Stored name")).toBe("Stored name");
  });
});
