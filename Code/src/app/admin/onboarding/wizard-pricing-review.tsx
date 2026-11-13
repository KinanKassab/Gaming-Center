"use client";

import { useId } from "react";
import { Overlay, OverlayFooter } from "@/app/_components/overlay";
import { pricingPlanAmountLabel } from "@/app/_lib/display";
import { useLocale, useT } from "@/i18n/provider";
import type { DeviceHourlyPriceRow, DeviceOfferPriceRow } from "@/modules/gaming/pricing-device-summary";

export function WizardPricingReview(props: {
  hourly: DeviceHourlyPriceRow[];
  offers: DeviceOfferPriceRow[];
  onStay: () => void;
  onContinue: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const titleId = useId();
  const bodyId = useId();

  return (
    <Overlay
      kind="dialog"
      labelledBy={titleId}
      describedBy={bodyId}
      size="md"
      closeOnScrim={false}
      onClose={props.onStay}
    >
      <h2 id={titleId}>{t("onboarding.pricingReviewTitle")}</h2>
      <p id={bodyId} className="hint">
        {t("onboarding.pricingReviewBody")}
      </p>
      {props.hourly.length > 0 ? (
        <ul className="pricing-saved-list">
          {props.hourly.map((row) => (
            <li key={`${row.scopeType}:${row.deviceId}`}>
              {row.deviceName}:{" "}
              {pricingPlanAmountLabel(
                {
                  pricingModel: "TIME_BASED",
                  currency: row.currency,
                  rateMinor: row.rateMinor,
                  billingUnitSeconds: row.billingUnitSeconds,
                  roundingMode: row.roundingMode,
                  timeBillingMode: row.timeBillingMode,
                },
                locale,
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {props.offers.length > 0 ? (
        <ul className="pricing-saved-list">
          {props.offers.map((row) => (
            <li key={row.planId}>
              {row.name}:{" "}
              {pricingPlanAmountLabel(
                {
                  pricingModel: "PACKAGE",
                  currency: row.currency,
                  packagePriceMinor: row.packagePriceMinor,
                  packageDurationSeconds: row.packageDurationSeconds,
                },
                locale,
              )}{" "}
              · {row.deviceNames.join(", ")}
            </li>
          ))}
        </ul>
      ) : (
        props.hourly.length === 0 ? <p>{t("onboarding.pricingNone")}</p> : null
      )}
      <OverlayFooter>
        <button type="button" className="btn-secondary" onClick={props.onStay}>
          {t("onboarding.stayAndEdit")}
        </button>
        <button type="button" onClick={props.onContinue}>
          {t("onboarding.saveAndContinue")}
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
