"use client";

import { useId } from "react";
import { currencyFractionDigits, majorToMinor, minorToMajorString, parseMinorUnits } from "@/core/money";
import { useT } from "@/i18n/provider";
import { joinDescribedBy } from "@/ui/accessible-name";

export function sanitizeMoneyInput(value: string, fractionDigits: number): string {
  if (fractionDigits === 0) return value.replace(/\D/g, "");

  const normalized = value.replace(/[^\d.]/g, "");
  const [whole = "", ...fractionParts] = normalized.split(".");
  if (fractionParts.length === 0) return whole;
  return `${whole}.${fractionParts.join("").slice(0, fractionDigits)}`;
}

export function MoneyInput(props: {
  name?: string;
  currency: string;
  valueMajor: string;
  onChange: (major: string) => void;
  required?: boolean;
  optional?: boolean;
  id?: string;
  describedBy?: string;
}) {
  const t = useT();
  const hintId = useId();
  const digits = currencyFractionDigits(props.currency);
  const step = digits === 0 ? "1" : (1 / 10 ** digits).toFixed(digits);
  const hint =
    digits === 0
      ? t("common.wholeAmounts", { currency: props.currency })
      : t("common.decimalHint", { digits, step });
  const describedBy = joinDescribedBy(props.describedBy, hintId);

  return (
    <div className="money-input">
      <div className="money-input-row">
        <input
          id={props.id}
          name={props.name}
          inputMode={digits === 0 ? "numeric" : "decimal"}
          pattern={digits === 0 ? "[0-9]*" : `[0-9]*([.][0-9]{0,${digits}})?`}
          autoComplete="off"
          value={props.valueMajor}
          required={props.required && !props.optional}
          {...(describedBy ? { "aria-describedby": describedBy } : {})}
          onChange={(event) => props.onChange(sanitizeMoneyInput(event.target.value, digits))}
        />
        <span className="money-currency" aria-hidden="true">
          {props.currency}
        </span>
      </div>
      <span className="hint" id={hintId}>
        {hint}
      </span>
    </div>
  );
}

export function majorStringToMinorString(major: string, currency: string): string {
  return majorToMinor(major, currencyFractionDigits(currency)).toString();
}

export function minorStringToMajorString(minor: string, currency: string): string {
  return minorToMajorString(parseMinorUnits(minor), currencyFractionDigits(currency));
}
