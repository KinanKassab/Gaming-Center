import { TIME_BILLING_UNIT } from "@/modules/gaming/billing-prorated";

export function shouldExposeBillingUnitSecondsSetting(
  plans: Array<{ pricingModel: string; timeBillingMode: string | null }>,
): boolean {
  return plans.some(
    (plan) => plan.pricingModel === "TIME_BASED" && plan.timeBillingMode === TIME_BILLING_UNIT,
  );
}
