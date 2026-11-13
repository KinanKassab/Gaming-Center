"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText } from "@/app/admin/_components/api";
import {
  WizardDeviceTypeStep,
  type WizardDeviceTypeChanges,
} from "@/app/admin/onboarding/wizard-device-type-step";
import { persistDeviceTypeDraft } from "@/app/admin/onboarding/persist-device-type-draft";
import { useLocale, useT } from "@/i18n/provider";

export function HallDevicesHost(props: {
  branches: Array<{ id: string; name: string }>;
  areas: Array<{ id: string; branchId: string; name: string }>;
  deviceTypes: Array<{ id: string; name: string }>;
  devices: Array<{ deviceTypeId: string }>;
  preferredBranchId?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branch = useMemo(() => {
    if (props.preferredBranchId) {
      return props.branches.find((row) => row.id === props.preferredBranchId) ?? props.branches[0];
    }
    return props.branches[0];
  }, [props.branches, props.preferredBranchId]);
  const area = useMemo(() => {
    if (!branch) return props.areas[0];
    return props.areas.find((row) => row.branchId === branch.id) ?? props.areas[0];
  }, [branch, props.areas]);

  async function saveChanges(changes: WizardDeviceTypeChanges): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await persistDeviceTypeDraft({
      changes,
      ...(branch ? { branchId: branch.id } : {}),
      ...(area ? { areaId: area.id } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(apiErrorText(result.error, locale));
      router.refresh();
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <WizardDeviceTypeStep
        titleKey="devices.hallTypesTitle"
        hintKey="devices.hallTypesHint"
        deviceTypes={props.deviceTypes}
        devices={props.devices}
        canSetCounts={Boolean(branch && area)}
        busy={busy}
        onSaveChanges={saveChanges}
      />
      {error ? <p className="error">{error}</p> : null}
      {!branch || !area ? <p className="hint">{t("devices.createNeed")}</p> : null}
    </>
  );
}
