import { describe, expect, it } from "vitest";
import { TIME_BILLING_PRORATED_HOUR, TIME_BILLING_UNIT } from "@/modules/gaming/billing-prorated";
import { shouldExposeBillingUnitSecondsSetting } from "@/ui/billing-unit-setting";

describe("BUG-019 billing unit seconds owner Settings presentation", () => {
  it("hides the raw seconds setting for PRORATED_HOUR-only tenants", () => {
    expect(
      shouldExposeBillingUnitSecondsSetting([
        { pricingModel: "TIME_BASED", timeBillingMode: TIME_BILLING_PRORATED_HOUR },
        { pricingModel: "PACKAGE", timeBillingMode: null },
      ]),
    ).toBe(false);
  });

  it("keeps the setting available when a legacy UNIT time plan is active", () => {
    expect(
      shouldExposeBillingUnitSecondsSetting([
        { pricingModel: "TIME_BASED", timeBillingMode: TIME_BILLING_UNIT },
      ]),
    ).toBe(true);
  });
});
