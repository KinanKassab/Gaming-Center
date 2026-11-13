"use client";

import { useMemo, useState } from "react";
import { durationToSeconds, secondsToDuration } from "@/core/duration";
import { useT } from "@/i18n/provider";

const PRESET_SECONDS = [30 * 60, 3600, 90 * 60, 7200, 3 * 3600] as const;

export function DurationPicker(props: {
  name?: string;
  valueSeconds: number;
  onChange: (seconds: number) => void;
  includeSeconds?: boolean;
  labelledBy?: string;
}) {
  const t = useT();
  const presets = [
    { label: t("duration.min30"), seconds: PRESET_SECONDS[0] },
    { label: t("duration.hour1"), seconds: PRESET_SECONDS[1] },
    { label: t("duration.hour15"), seconds: PRESET_SECONDS[2] },
    { label: t("duration.hour2"), seconds: PRESET_SECONDS[3] },
    { label: t("duration.hour3"), seconds: PRESET_SECONDS[4] },
  ];
  const parts = secondsToDuration(props.valueSeconds);
  const [custom, setCustom] = useState(
    () => !PRESET_SECONDS.some((seconds) => seconds === props.valueSeconds),
  );
  const hourOptions = useMemo(() => Array.from({ length: 25 }, (_, i) => i), []);
  const minuteOptions = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);
  const secondOptions = minuteOptions;
  const matched = presets.find((preset) => preset.seconds === props.valueSeconds);

  function setSeconds(next: number) {
    props.onChange(Math.max(0, next));
  }

  return (
    <div className="duration-picker" aria-labelledby={props.labelledBy}>
      {props.name ? <input type="hidden" name={props.name} value={String(props.valueSeconds)} /> : null}
      <div className="duration-presets" role="group" aria-label={t("duration.presets")}>
        {presets.map((preset) => (
          <button
            key={preset.seconds}
            type="button"
            aria-pressed={matched?.seconds === preset.seconds && !custom}
            onClick={() => {
              setCustom(false);
              setSeconds(preset.seconds);
            }}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" aria-pressed={custom || !matched} onClick={() => setCustom(true)}>
          {t("duration.custom")}
        </button>
      </div>
      <div className={`duration-wheels${props.includeSeconds ? " with-seconds" : ""}`}>
        <label>
          {t("duration.hours")}
          <select
            value={parts.hours}
            onChange={(event) => {
              setCustom(true);
              setSeconds(durationToSeconds(Number(event.target.value), parts.minutes, parts.seconds));
            }}
          >
            {hourOptions.map((hour) => (
              <option key={hour} value={hour}>
                {hour}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("duration.minutes")}
          <select
            value={parts.minutes}
            onChange={(event) => {
              setCustom(true);
              setSeconds(durationToSeconds(parts.hours, Number(event.target.value), parts.seconds));
            }}
          >
            {minuteOptions.map((minute) => (
              <option key={minute} value={minute}>
                {String(minute).padStart(2, "0")}
              </option>
            ))}
          </select>
        </label>
        {props.includeSeconds ? (
          <label>
            {t("duration.seconds")}
            <select
              value={parts.seconds}
              onChange={(event) => {
                setCustom(true);
                setSeconds(durationToSeconds(parts.hours, parts.minutes, Number(event.target.value)));
              }}
            >
              {secondOptions.map((second) => (
                <option key={second} value={second}>
                  {String(second).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
