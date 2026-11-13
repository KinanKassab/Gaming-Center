"use client";

import { apiRequest, type ApiResult } from "@/app/admin/_components/api";
import type { WizardDeviceTypeChanges } from "@/app/admin/onboarding/wizard-device-type-step";

type ApiFailure = Extract<ApiResult, { ok: false }>;

export type PersistDeviceTypeDraftResult = { ok: true } | { ok: false; error: ApiFailure };

function localFailure(message: string): PersistDeviceTypeDraftResult {
  return { ok: false, error: { ok: false, status: 400, message } };
}

function createdRecordId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: { id?: unknown } }).data;
  return typeof data?.id === "string" ? data.id : null;
}

export async function persistDeviceTypeDraft(input: {
  changes: WizardDeviceTypeChanges;
  branchId?: string;
  areaId?: string;
}): Promise<PersistDeviceTypeDraftResult> {
  const needsPlace =
    input.changes.addDevices.length > 0 || input.changes.create.some((draft) => draft.count > 0);
  if (needsPlace && (!input.branchId || !input.areaId)) {
    return localFailure("Add a branch and area before saving device counts");
  }

  async function request(path: string, body: Record<string, unknown>) {
    return apiRequest(path, { method: "POST", body });
  }

  for (const deviceTypeId of input.changes.archiveTypeIds) {
    const result = await request(`/api/gaming/device-types/${deviceTypeId}/wizard-archive`, {});
    if (!result.ok) return { ok: false, error: result };
  }

  for (const addition of input.changes.addDevices) {
    const result = await request("/api/gaming/devices/bulk", {
      branchId: input.branchId,
      areaId: input.areaId,
      deviceTypeId: addition.deviceTypeId,
      count: addition.count,
    });
    if (!result.ok) return { ok: false, error: result };
  }

  for (const draft of input.changes.create) {
    const created = await request("/api/gaming/device-types", { name: draft.name });
    if (!created.ok) return { ok: false, error: created };
    const deviceTypeId = createdRecordId(created.body);
    if (!deviceTypeId) return localFailure("The created device type response was incomplete");
    if (draft.count > 0) {
      const devices = await request("/api/gaming/devices/bulk", {
        branchId: input.branchId,
        areaId: input.areaId,
        deviceTypeId,
        count: draft.count,
      });
      if (!devices.ok) return { ok: false, error: devices };
    }
  }

  return { ok: true };
}
