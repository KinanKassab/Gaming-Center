"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { FormField } from "@/app/_components/form-field";
import { MoneyInput, majorStringToMinorString } from "@/app/_components/money-input";
import { StatusBadge } from "@/app/_components/page-ui";
import { Dialog, OverlayFooter, OverlayHeader } from "@/app/_components/overlay";
import { useLocale, useT } from "@/i18n/provider";
import { isPositiveHourlyRate } from "@/ui/hall-hourly-price";

export function DeviceHallPriceCell(props: {
  deviceId: string;
  deviceName: string;
  currency: string;
  hallReady: boolean;
  archived: boolean;
  operationalStatus: string;
  operationalLabel: string;
  canManage: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const titleId = useId();
  const priceId = useId();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPrice = !props.archived && !props.hallReady;
  const showReady = !props.archived && props.hallReady && props.operationalStatus === "ENABLED";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    let minor = "0";
    try {
      minor = majorStringToMinorString(price, props.currency);
    } catch {
      setError(t("apiError.hourlyPriceNotPositive"));
      return;
    }
    if (!isPositiveHourlyRate(minor)) {
      setError(t("apiError.hourlyPriceNotPositive"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/gaming/device-prices", {
      method: "POST",
      body: {
        kind: "HOURLY",
        deviceIds: [props.deviceId],
        priceMajor: price.trim(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(apiErrorText(result, locale));
      return;
    }
    setOpen(false);
    setPrice("");
    router.refresh();
  }

  return (
    <div className="device-hall-status">
      {needsPrice ? (
        <div className="device-price-alert">
          <StatusBadge tone="warning">{t("devices.needsHallPrice")}</StatusBadge>
          {props.operationalStatus !== "ENABLED" ? (
            <StatusBadge tone={props.operationalStatus === "MAINTENANCE" ? "warning" : "danger"}>
              {props.operationalLabel}
            </StatusBadge>
          ) : null}
          {props.canManage ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
              {t("devices.addHallPrice")}
            </button>
          ) : null}
        </div>
      ) : (
        <StatusBadge
          tone={
            props.archived
              ? "neutral"
              : props.operationalStatus === "ENABLED"
                ? "success"
                : props.operationalStatus === "MAINTENANCE"
                  ? "warning"
                  : "danger"
          }
        >
          {props.archived ? t("common.archived") : showReady ? t("status.operational.ENABLED") : props.operationalLabel}
        </StatusBadge>
      )}
      {open ? (
        <Dialog labelledBy={titleId} onClose={() => setOpen(false)} size="sm">
          <OverlayHeader titleId={titleId} title={t("devices.hallPriceTitle")} onClose={() => setOpen(false)} />
          <form className="stack" onSubmit={save}>
            <p className="hint">{t("devices.hallPriceBody", { name: props.deviceName })}</p>
            <FormField htmlFor={priceId} label={t("pricing.hourlyPrice")}>
              <MoneyInput
                id={priceId}
                currency={props.currency}
                valueMajor={price}
                onChange={setPrice}
                required
              />
            </FormField>
            {error ? <p className="error">{error}</p> : null}
            <OverlayFooter>
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={busy || !price.trim()}>
                {busy ? t("common.saving") : t("pricing.createHourly")}
              </button>
            </OverlayFooter>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
