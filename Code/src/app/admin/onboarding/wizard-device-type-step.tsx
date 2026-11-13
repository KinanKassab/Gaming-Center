"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Toggle } from "@/app/_components/toggle";
import { useT } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/t";
import { BULK_DEVICE_MAX_COUNT } from "@/modules/gaming/device-names-limit";
import {
  additionalDevicesToCreate,
  DEVICE_TYPE_SUGGESTION_IDS,
  findMatchingDeviceType,
  foldDeviceTypeName,
  isExistingDeviceTypeName,
  type DeviceTypeSuggestionId,
} from "@/modules/onboarding/device-type-suggestions";

const SUGGESTION_LABEL: Record<DeviceTypeSuggestionId, MessageKey> = {
  ps5: "onboarding.typeSuggestPs5",
  ps4: "onboarding.typeSuggestPs4",
  xbox: "onboarding.typeSuggestXbox",
  pc: "onboarding.typeSuggestPc",
  billiards: "onboarding.typeSuggestBilliards",
  vr: "onboarding.typeSuggestVr",
  switch: "onboarding.typeSuggestSwitch",
};

type SavedType = { id: string; name: string };
type DraftRow = { key: string; name: string; saved?: SavedType };

export type WizardDeviceTypeChanges = {
  create: Array<{ name: string; count: number }>;
  addDevices: Array<{ deviceTypeId: string; count: number }>;
  archiveTypeIds: string[];
};

export type WizardDeviceTypeDraftState = {
  changes: WizardDeviceTypeChanges;
  hasChanges: boolean;
  isValid: boolean;
  isReady: boolean;
};

export function WizardDeviceTypeStep(props: {
  deviceTypes: SavedType[];
  devices: Array<{ deviceTypeId: string }>;
  canSetCounts: boolean;
  busy: boolean;
  titleKey?: MessageKey;
  hintKey?: MessageKey;
  showSaveAction?: boolean;
  onDraftStateChange?: (state: WizardDeviceTypeDraftState) => void;
  onSaveChanges: (changes: WizardDeviceTypeChanges) => Promise<boolean>;
}) {
  const t = useT();
  const customToggleId = useId();
  const [customName, setCustomName] = useState("");
  const [customEnabled, setCustomEnabled] = useState(false);
  const [pendingNames, setPendingNames] = useState<string[]>([]);
  const [enabledDrafts, setEnabledDrafts] = useState<Record<string, boolean>>({});
  const [countDrafts, setCountDrafts] = useState<Record<string, string>>({});
  const labels: Partial<Record<DeviceTypeSuggestionId, string>> = {};
  for (const id of DEVICE_TYPE_SUGGESTION_IDS) {
    labels[id] = t(SUGGESTION_LABEL[id]);
  }

  const existingByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const device of props.devices) {
      counts[device.deviceTypeId] = (counts[device.deviceTypeId] ?? 0) + 1;
    }
    return counts;
  }, [props.devices]);

  useEffect(() => {
    setEnabledDrafts({});
    setCountDrafts({});
    setPendingNames((current) => {
      const next = current.filter((name) => !isExistingDeviceTypeName(name, props.deviceTypes, labels));
      return next.length === current.length ? current : next;
    });
    // Locale labels are read from this render; types are the saved-row source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid looping on a fresh labels object
  }, [props.deviceTypes, props.devices]);

  const customTypes = props.deviceTypes.filter(
    (type) => !DEVICE_TYPE_SUGGESTION_IDS.some((id) => findMatchingDeviceType(labels[id] ?? id, [type], labels)),
  );

  const customTrimmed = customName.trim();
  const knownNames = [
    ...props.deviceTypes,
    ...pendingNames.map((name) => ({ name })),
    ...DEVICE_TYPE_SUGGESTION_IDS.map((id) => ({ name: labels[id] ?? id })),
  ];
  const customAlreadyAdded =
    customTrimmed.length > 0 && isExistingDeviceTypeName(customTrimmed, knownNames, labels);

  function onCustomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customTrimmed || props.busy || customAlreadyAdded) return;
    const key = `draft:${foldDeviceTypeName(customTrimmed)}`;
    setPendingNames((current) => [...current, customTrimmed]);
    setEnabledDrafts((current) => ({ ...current, [key]: true }));
    setCountDrafts((current) => ({ ...current, [key]: "1" }));
    setCustomName("");
  }

  const rows: DraftRow[] = [
    ...DEVICE_TYPE_SUGGESTION_IDS.map((id) => {
      const name = labels[id] ?? id;
      const saved = findMatchingDeviceType(name, props.deviceTypes, labels);
      return {
        key: saved?.id ?? `suggestion:${id}`,
        name,
        ...(saved ? { saved } : {}),
      };
    }),
    ...customTypes.map((saved) => ({ key: saved.id, name: saved.name, saved })),
    ...pendingNames.map((name) => ({ key: `draft:${foldDeviceTypeName(name)}`, name })),
  ];

  function enabledFor(row: DraftRow) {
    return enabledDrafts[row.key] ?? Boolean(row.saved);
  }

  function countFor(row: DraftRow) {
    const existingCount = row.saved ? (existingByType[row.saved.id] ?? 0) : 0;
    return countDrafts[row.key] ?? String(row.saved ? existingCount : 1);
  }

  function desiredCount(row: DraftRow): number | null {
    const value = Number(countFor(row));
    const existingCount = row.saved ? (existingByType[row.saved.id] ?? 0) : 0;
    const max = existingCount + BULK_DEVICE_MAX_COUNT;
    const min = row.saved ? existingCount : 1;
    if (!Number.isInteger(value) || value < min || value > max) return null;
    return value;
  }

  function buildChanges(): WizardDeviceTypeChanges {
    const changes: WizardDeviceTypeChanges = { create: [], addDevices: [], archiveTypeIds: [] };
    for (const row of rows) {
      const enabled = enabledFor(row);
      if (row.saved) {
        if (!enabled) {
          changes.archiveTypeIds.push(row.saved.id);
          continue;
        }
        if (!props.canSetCounts) continue;
        const existingCount = existingByType[row.saved.id] ?? 0;
        const desired = desiredCount(row);
        if (desired === null) continue;
        const extra = additionalDevicesToCreate(desired, existingCount, BULK_DEVICE_MAX_COUNT);
        if (extra > 0) changes.addDevices.push({ deviceTypeId: row.saved.id, count: extra });
        continue;
      }
      if (!enabled) continue;
      changes.create.push({
        name: row.name,
        count: props.canSetCounts ? (desiredCount(row) ?? 0) : 0,
      });
    }
    return changes;
  }

  const hasInvalidCount = rows.some(
    (row) => props.canSetCounts && enabledFor(row) && desiredCount(row) === null,
  );
  const changes = buildChanges();
  const hasChanges =
    changes.create.length > 0 || changes.addDevices.length > 0 || changes.archiveTypeIds.length > 0;
  const isReady = rows.some((row) => {
    if (!enabledFor(row) || !props.canSetCounts) return false;
    const count = desiredCount(row);
    return count !== null && count > 0;
  });
  const changesSignature = JSON.stringify(changes);
  const onDraftStateChange = props.onDraftStateChange;

  useEffect(() => {
    onDraftStateChange?.({
      changes,
      hasChanges,
      isValid: !hasInvalidCount,
      isReady,
    });
    // The signature captures the complete serializable draft without forcing
    // the parent to update after an equivalent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changesSignature, hasChanges, hasInvalidCount, isReady, onDraftStateChange]);

  function renderRow(row: DraftRow) {
    const saved = row.saved;
    const enabled = enabledFor(row);
    const existingCount = saved ? (existingByType[saved.id] ?? 0) : 0;
    const countValue = countFor(row);
    return (
      <li key={row.key} className={`setup-type-row${enabled ? " is-added" : ""}`}>
        <label className="setup-type-check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={props.busy}
            onChange={(event) => {
              const checked = event.target.checked;
              if (!checked && !saved && row.key.startsWith("draft:")) {
                setPendingNames((current) => current.filter((name) => name !== row.name));
                setEnabledDrafts((current) => ({ ...current, [row.key]: false }));
                return;
              }
              setEnabledDrafts((current) => ({ ...current, [row.key]: checked }));
            }}
          />
          <span>{saved?.name ?? row.name}</span>
        </label>
        <label className="setup-type-count">
          {t("onboarding.typeDeviceCount")}
          <input
            type="number"
            inputMode="numeric"
            min={saved ? existingCount : 1}
            max={existingCount + BULK_DEVICE_MAX_COUNT}
            value={countValue}
            disabled={props.busy || !enabled || !props.canSetCounts}
            aria-invalid={enabled && props.canSetCounts && desiredCount(row) === null}
            onChange={(event) => {
              const value = event.target.value;
              setCountDrafts((current) => ({ ...current, [row.key]: value }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
              }
            }}
          />
        </label>
      </li>
    );
  }

  return (
    <section className="card">
      <h2>{t(props.titleKey ?? "onboarding.typeTitle")}</h2>
      <p className="hint">{t(props.hintKey ?? "onboarding.typeCountHint")}</p>

      <div className="setup-choice-block">
        <h3>{t("onboarding.typeSuggestions")}</h3>
        <ul className="setup-type-list">
          {rows.map(renderRow)}
        </ul>
      </div>

      {!props.canSetCounts && props.deviceTypes.length > 0 ? (
        <p className="hint">{t("onboarding.typeNeedPlace")}</p>
      ) : null}

      <div className="setup-custom-section">
        <div className="form-field-label-row setup-custom-toggle">
          <span id={customToggleId}>{t("onboarding.typeCustom")}</span>
          <Toggle
            labelledBy={customToggleId}
            checked={customEnabled}
            disabled={props.busy}
            onChange={setCustomEnabled}
          />
        </div>
        {customEnabled ? (
          <form className="stack setup-custom-form" onSubmit={onCustomSubmit}>
            <label>
              {t("onboarding.typeName")}
              <input
                name="name"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder={t("onboarding.typePlaceholder")}
                required
                autoComplete="off"
              />
            </label>
            {customAlreadyAdded ? <p className="hint">{t("onboarding.typeAlready")}</p> : null}
            <button type="submit" disabled={props.busy || customAlreadyAdded || customTrimmed.length === 0}>
              {t("onboarding.addTypeDraft")}
            </button>
          </form>
        ) : null}
      </div>

      {props.showSaveAction !== false ? (
        <div className="setup-dialog-toolbar">
          <button
            type="button"
            disabled={props.busy || !hasChanges || hasInvalidCount}
            onClick={() => void props.onSaveChanges(changes)}
          >
            {props.busy ? t("common.saving") : t("onboarding.saveDevices")}
          </button>
          {hasChanges ? <span className="hint">{t("onboarding.unsavedDeviceChanges")}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
