"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { FormField } from "@/app/_components/form-field";
import { StatusBadge } from "@/app/_components/page-ui";
import { useT, useLocale } from "@/i18n/provider";
import { formatDateTimeForDisplay, formatMinorAmountForDisplay } from "@/i18n/format";
import { paymentMethodLabel } from "@/i18n/payment-method";

type Method = {
  code: string;
  name: string;
  methodType: string;
  requiresReference: boolean;
  recordingMode: string;
  integration: string;
};

type DrinkLine = {
  orderId: string;
  orderItemId: string;
  chargeId: string;
  chargeItemId: string;
  description: string;
  totalMinor: string;
  paidMinor: string;
  remainingMinor: string;
  fullyPaid: boolean;
};

type PlayLine = {
  chargeId: string | null;
  totalMinor: string;
  appliedMinor: string;
  remainingMinor: string;
};

export function CheckoutSalesCard(props: {
  sessionId: string;
  customerLabel: string;
  playingStartedAt: string | null;
  playingEndedAt: string | null;
  play: PlayLine | null;
  drinks: DrinkLine[];
  appliedMinor: string;
  remainingMinor: string;
  currency: string;
  methods: Method[];
  canPay: boolean;
  guestMustPayInFull: boolean;
  frozenHint: string;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const methodId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [methodCode, setMethodCode] = useState(props.methods[0]?.code ?? "CASH");
  const [selectedPlay, setSelectedPlay] = useState(false);
  const [selectedDrinks, setSelectedDrinks] = useState<Record<string, boolean>>({});

  const unpaidDrinks = props.drinks.filter((d) => !d.fullyPaid && BigInt(d.remainingMinor) > 0n);
  const playRemaining = props.play && BigInt(props.play.remainingMinor) > 0n ? props.play : null;

  function toggleDrink(chargeItemId: string) {
    setSelectedDrinks((current) => ({ ...current, [chargeItemId]: !current[chargeItemId] }));
  }

  function selectPlayOnly() {
    setSelectedPlay(true);
    setSelectedDrinks({});
  }

  function selectDrinkOnly(chargeItemId: string) {
    setSelectedPlay(false);
    setSelectedDrinks({ [chargeItemId]: true });
  }

  function selectAllDrinks() {
    setSelectedPlay(false);
    const next: Record<string, boolean> = {};
    for (const drink of unpaidDrinks) next[drink.chargeItemId] = true;
    setSelectedDrinks(next);
  }

  function selectPayAll() {
    setSelectedPlay(Boolean(playRemaining));
    const next: Record<string, boolean> = {};
    for (const drink of unpaidDrinks) next[drink.chargeItemId] = true;
    setSelectedDrinks(next);
  }

  const allocations = useMemo(() => {
    const byCharge = new Map<string, bigint>();
    if (selectedPlay && playRemaining?.chargeId) {
      byCharge.set(playRemaining.chargeId, BigInt(playRemaining.remainingMinor));
    }
    for (const drink of unpaidDrinks) {
      if (!selectedDrinks[drink.chargeItemId]) continue;
      const prev = byCharge.get(drink.chargeId) ?? 0n;
      byCharge.set(drink.chargeId, prev + BigInt(drink.remainingMinor));
    }
    return [...byCharge.entries()]
      .filter(([, amount]) => amount > 0n)
      .map(([chargeId, amount]) => ({ chargeId, amountMinor: amount.toString() }));
  }, [selectedPlay, selectedDrinks, playRemaining, unpaidDrinks]);

  const payAmount = allocations.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (allocations.length === 0) {
      setError(t("checkout.selectItems"));
      return;
    }
    if (props.guestMustPayInFull && payAmount !== BigInt(props.remainingMinor)) {
      setError(t("checkout.guestMustPay"));
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/gaming/sessions/${props.sessionId}/payments`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: {
        allocations,
        currency: props.currency,
        paymentMethodCode: methodCode,
      },
    });
    setBusy(false);
    if (result.ok) {
      setSelectedPlay(false);
      setSelectedDrinks({});
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  const playingLabel =
    props.playingStartedAt && props.playingEndedAt
      ? `${formatDateTimeForDisplay(props.playingStartedAt, locale)} – ${formatDateTimeForDisplay(props.playingEndedAt, locale)}`
      : props.playingStartedAt
        ? formatDateTimeForDisplay(props.playingStartedAt, locale)
        : "—";

  return (
    <div className="stack sales-card">
      <section className="card">
        <p>
          <strong>{t("checkout.customer")}:</strong> {props.customerLabel}
        </p>
        <p>
          <strong>{t("checkout.playingTime")}:</strong> {playingLabel}
        </p>
        {props.canPay && BigInt(props.remainingMinor) > 0n ? (
          <button type="button" className="btn-secondary" onClick={selectPayAll}>
            {t("checkout.payAll")}
          </button>
        ) : null}
        <p className="hint">{props.frozenHint}</p>
      </section>

      <section className="card">
        <h2>{t("checkout.playSection")}</h2>
        {props.play ? (
          <div className={`sales-line ${playRemaining ? "" : "sales-line-paid"}`}>
            <label className="sales-line-main">
              {props.canPay && playRemaining && props.play?.chargeId ? (
                <input
                  type="checkbox"
                  checked={selectedPlay}
                  onChange={() => setSelectedPlay((v) => !v)}
                />
              ) : null}
              <span>{t("checkout.playBill")}</span>
              <strong>{formatMinorAmountForDisplay(props.play.totalMinor, props.currency, locale)}</strong>
            </label>
            {playRemaining ? (
              <StatusBadge tone="warning">
                {formatMinorAmountForDisplay(playRemaining.remainingMinor, props.currency, locale)}
              </StatusBadge>
            ) : (
              <StatusBadge tone="success">{t("checkout.paid")}</StatusBadge>
            )}
            {props.canPay && playRemaining ? (
              <button type="button" className="btn-secondary" onClick={selectPlayOnly}>
                {t("checkout.pay")}
              </button>
            ) : null}
          </div>
        ) : (
          <p>—</p>
        )}
      </section>

      <section className="card">
        <h2>{t("checkout.drinksSection")}</h2>
        {props.drinks.length === 0 ? (
          <p>{t("checkout.noDrinks")}</p>
        ) : (
          <ul className="sales-lines">
            {props.drinks.map((drink) => (
              <li
                key={drink.chargeItemId}
                className={`sales-line ${drink.fullyPaid ? "sales-line-paid" : ""}`}
              >
                <label className="sales-line-main">
                  {props.canPay && !drink.fullyPaid ? (
                    <input
                      type="checkbox"
                      checked={Boolean(selectedDrinks[drink.chargeItemId])}
                      onChange={() => toggleDrink(drink.chargeItemId)}
                    />
                  ) : null}
                  <span>{drink.description}</span>
                  <strong>{formatMinorAmountForDisplay(drink.totalMinor, props.currency, locale)}</strong>
                </label>
                {drink.fullyPaid ? (
                  <StatusBadge tone="success">{t("checkout.paid")}</StatusBadge>
                ) : (
                  <>
                    <StatusBadge tone="warning">
                      {formatMinorAmountForDisplay(drink.remainingMinor, props.currency, locale)}
                    </StatusBadge>
                    {props.canPay ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => selectDrinkOnly(drink.chargeItemId)}
                      >
                        {t("checkout.pay")}
                      </button>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {props.canPay && unpaidDrinks.length > 0 ? (
          <button type="button" className="btn-secondary" onClick={selectAllDrinks}>
            {t("checkout.payAll")}
          </button>
        ) : null}
      </section>

      <section className="card">
        <h2>{t("checkout.paymentSummary")}</h2>
        <p>
          {t("checkout.alreadyPaid")}:{" "}
          {formatMinorAmountForDisplay(props.appliedMinor, props.currency, locale)}
        </p>
        <p>
          {t("checkout.remaining")}:{" "}
          <strong>{formatMinorAmountForDisplay(props.remainingMinor, props.currency, locale)}</strong>
        </p>
      </section>

      {props.canPay && BigInt(props.remainingMinor) > 0n ? (
        <section className="card">
          <h2>{t("checkout.recordHeading")}</h2>
          <p>
            {t("checkout.amount")}:{" "}
            <strong>
              {formatMinorAmountForDisplay(payAmount.toString(), props.currency, locale)}
            </strong>
          </p>
          <form className="stack" onSubmit={onSubmit}>
            <FormField htmlFor={methodId} label={t("checkout.method")}>
              <select
                id={methodId}
                name="paymentMethodCode"
                value={methodCode}
                onChange={(event) => setMethodCode(event.target.value)}
              >
                {props.methods.map((method) => (
                  <option key={method.code} value={method.code}>
                    {paymentMethodLabel(method.code, locale, method.name)}
                  </option>
                ))}
              </select>
            </FormField>
            {error ? <p className="error">{error}</p> : null}
            <button type="submit" disabled={busy || props.methods.length === 0 || allocations.length === 0}>
              {busy ? t("common.working") : t("checkout.paySelected")}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
