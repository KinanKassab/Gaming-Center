"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { DurationPicker } from "@/app/_components/duration-picker";
import { formatDurationForDisplay } from "@/i18n/duration";
import type { AppLocale } from "@/i18n/locales";
import { useLocale, useT } from "@/i18n/provider";

export function SettingValueEditor(props: {
  settingKey: string;
  valueType: string;
  currentValue: unknown;
  savePath: string;
  resetPath: string;
  canManage: boolean;
  hasOverride: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const durationSeconds = props.settingKey === "gaming.billing_unit_seconds";
  const [raw, setRaw] = useState(valueToInput(props.valueType, props.currentValue));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!props.canManage) {
    return durationSeconds ? (
      <span>{displayDurationSeconds(props.currentValue, locale)}</span>
    ) : (
      <code>{displayValue(props.currentValue)}</code>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    const parsed = parseInput(props.valueType, raw);
    if (!parsed.ok) {
      setBusy(false);
      setError(parsed.code === "BOOLEAN" ? t("settings.invalidBoolean") : t("settings.invalidNumber"));
      return;
    }
    const result = await apiRequest(props.savePath, { method: "PUT", body: { value: parsed.value } });
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  async function reset() {
    if (!window.confirm(t("settings.resetConfirm"))) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest(props.resetPath, { method: "DELETE" });
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  const seconds = Number(raw);
  const durationValue = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 60;

  return (
    <span className="setting-editor">
      {props.valueType === "BOOLEAN" ? (
        <select value={raw} onChange={(event) => setRaw(event.target.value)} disabled={busy}>
          <option value="true">{t("common.yes")}</option>
          <option value="false">{t("common.no")}</option>
        </select>
      ) : durationSeconds ? (
        <DurationPicker
          valueSeconds={durationValue}
          includeSeconds
          onChange={(next) => setRaw(String(next))}
        />
      ) : (
        <input
          type={props.valueType === "NUMBER" ? "number" : "text"}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          disabled={busy}
        />
      )}
      <button type="button" onClick={save} disabled={busy}>
        {busy ? "…" : t("common.save")}
      </button>
      {props.hasOverride ? (
        <button type="button" className="link" onClick={reset} disabled={busy}>
          {t("common.reset")}
        </button>
      ) : null}
      {error ? <span className="error"> {error}</span> : null}
    </span>
  );
}

function valueToInput(valueType: string, value: unknown): string {
  if (valueType === "BOOLEAN") return value === true ? "true" : "false";
  if (value == null) return "";
  return String(value);
}

function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function displayDurationSeconds(value: unknown, locale: AppLocale): string {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds)) return "—";
  return formatDurationForDisplay(seconds, locale);
}

function parseInput(
  valueType: string,
  raw: string,
): { ok: true; value: unknown } | { ok: false; code: "BOOLEAN" | "NUMBER" } {
  if (valueType === "BOOLEAN") {
    if (raw !== "true" && raw !== "false") return { ok: false, code: "BOOLEAN" };
    return { ok: true, value: raw === "true" };
  }
  if (valueType === "NUMBER") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false, code: "NUMBER" };
    return { ok: true, value };
  }
  return { ok: true, value: raw };
}
