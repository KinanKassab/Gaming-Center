"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { Combobox } from "@/app/_components/combobox";
import { DurationPicker } from "@/app/_components/duration-picker";
import { FormField } from "@/app/_components/form-field";
import { MoneyInput } from "@/app/_components/money-input";
import { Toggle } from "@/app/_components/toggle";
import { useLocale, useT } from "@/i18n/provider";

export function DevicePricingForm(props: {
  currency: string;
  deviceTypes: Array<{ id: string; name: string }>;
  hourlyPricedTypeIds?: readonly string[];
  onSuccess?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const typeFieldId = useId();
  const hourlyPriceId = useId();
  const offerToggleId = useId();
  const offerNameId = useId();
  const offerPriceId = useId();
  const durationId = useId();
  const [hourlyTypeId, setHourlyTypeId] = useState<string | null>(null);
  const [hourlyPrice, setHourlyPrice] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerName, setOfferName] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [offerTypeIds, setOfferTypeIds] = useState<string[]>([]);
  const [durationSeconds, setDurationSeconds] = useState(3600);
  const [hourlyError, setHourlyError] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [hourlyBusy, setHourlyBusy] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);

  const priced = useMemo(() => new Set(props.hourlyPricedTypeIds ?? []), [props.hourlyPricedTypeIds]);

  const hourlyOptions = props.deviceTypes
    .filter((type) => !priced.has(type.id))
    .map((type) => ({ value: type.id, label: type.name }));

  function toggleOfferType(typeId: string) {
    setOfferTypeIds((current) =>
      current.includes(typeId) ? current.filter((id) => id !== typeId) : [...current, typeId],
    );
  }

  async function saveHourly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hourlyBusy) return;
    if (!hourlyTypeId) {
      setHourlyError(t("apiError.deviceTypeRequired"));
      return;
    }
    setHourlyBusy(true);
    setHourlyError(null);
    const result = await apiRequest("/api/gaming/device-prices", {
      method: "POST",
      body: {
        kind: "HOURLY",
        deviceTypeIds: [hourlyTypeId],
        priceMajor: hourlyPrice,
      },
    });
    setHourlyBusy(false);
    if (result.ok) {
      setHourlyTypeId(null);
      setHourlyPrice("");
      props.onSuccess?.();
      router.refresh();
    } else {
      setHourlyError(apiErrorText(result, locale));
    }
  }

  async function saveOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offerBusy) return;
    if (offerTypeIds.length === 0) {
      setOfferError(t("apiError.deviceTypeRequired"));
      return;
    }
    setOfferBusy(true);
    setOfferError(null);
    const result = await apiRequest("/api/gaming/device-prices", {
      method: "POST",
      body: {
        kind: "OFFER",
        deviceTypeIds: offerTypeIds,
        name: offerName,
        priceMajor: offerPrice,
        durationSeconds,
      },
    });
    setOfferBusy(false);
    if (result.ok) {
      setOfferName("");
      setOfferPrice("");
      setOfferTypeIds([]);
      setDurationSeconds(3600);
      props.onSuccess?.();
      router.refresh();
    } else {
      setOfferError(apiErrorText(result, locale));
    }
  }

  if (props.deviceTypes.length === 0) {
    return <p>{t("onboarding.pricingNeedDevices")}</p>;
  }

  return (
    <div className="stack stack-wide">
      {hourlyOptions.length === 0 ? (
        <p className="hint">{t("pricing.allTypesHourly")}</p>
      ) : (
        <form className="stack" onSubmit={saveHourly}>
          <FormField htmlFor={typeFieldId} label={t("pricing.hourlyDeviceType")}>
            <Combobox
              id={typeFieldId}
              options={hourlyOptions}
              value={hourlyTypeId}
              onChange={setHourlyTypeId}
              placeholder={t("pricing.hourlyDeviceTypePlaceholder")}
            />
          </FormField>
          <FormField
            htmlFor={hourlyPriceId}
            label={t("pricing.hourlyPrice")}
            help={{
              title: t("pricing.hourlyPrice"),
              what: t("pricing.hourlyHelpWhat"),
              choose: t("pricing.helpChoose"),
              example: t("pricing.hourlyHelpExample", { currency: props.currency }),
            }}
          >
            <MoneyInput
              id={hourlyPriceId}
              currency={props.currency}
              valueMajor={hourlyPrice}
              onChange={setHourlyPrice}
              required
            />
          </FormField>
          <button type="submit" disabled={hourlyBusy || !hourlyPrice.trim()}>
            {hourlyBusy ? t("common.saving") : t("pricing.createHourly")}
          </button>
          {hourlyError ? <p className="error">{hourlyError}</p> : null}
        </form>
      )}

      <div className="pricing-offer-panel">
        <div className="form-field">
          <div className="form-field-label-row">
            <span id={offerToggleId} className="type-label">
              {t("pricing.offerToggle")}
            </span>
            <Toggle labelledBy={offerToggleId} checked={offerOpen} onChange={setOfferOpen} />
          </div>
          <p className="hint">{t("pricing.offerHint")}</p>
        </div>
        {offerOpen ? (
          <form className="stack" onSubmit={saveOffer}>
            <fieldset className="device-pick-fieldset">
              <legend>{t("pricing.offerDeviceTypes")}</legend>
              <div className="device-pick-list" role="group" aria-label={t("pricing.offerDeviceTypes")}>
                {props.deviceTypes.map((type) => {
                  const pressed = offerTypeIds.includes(type.id);
                  return (
                    <button
                      key={type.id}
                      type="button"
                      className="setup-choice device-pick"
                      aria-pressed={pressed}
                      onClick={() => toggleOfferType(type.id)}
                    >
                      {type.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <FormField htmlFor={offerNameId} label={t("pricing.offerName")}>
              <input
                id={offerNameId}
                value={offerName}
                onChange={(event) => setOfferName(event.target.value)}
                required
                placeholder={t("pricing.offerNamePlaceholder")}
                autoComplete="off"
              />
            </FormField>
            <div className="form-field">
              <div className="form-field-label-row">
                <span id={durationId} className="type-label">
                  {t("pricing.duration")}
                </span>
              </div>
              <DurationPicker labelledBy={durationId} valueSeconds={durationSeconds} onChange={setDurationSeconds} />
            </div>
            <FormField
              htmlFor={offerPriceId}
              label={t("pricing.offerPrice")}
              help={{
                title: t("pricing.offerPrice"),
                what: t("pricing.offerHelpWhat"),
                choose: t("pricing.helpChoose"),
                example: t("pricing.offerHelpExample", { currency: props.currency }),
              }}
            >
              <MoneyInput
                id={offerPriceId}
                currency={props.currency}
                valueMajor={offerPrice}
                onChange={setOfferPrice}
                required
              />
            </FormField>
            <button type="submit" disabled={offerBusy || !offerPrice.trim() || !offerName.trim()}>
              {offerBusy ? t("common.saving") : t("pricing.createOffer")}
            </button>
            {offerError ? <p className="error">{offerError}</p> : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}
