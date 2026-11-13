export type DevicePriceSummaryPlan = {
  id: string;
  name: string;
  status: string;
  pricingModel: string;
  currency: string;
  rateMinor: string | null;
  billingUnitSeconds: number | null;
  roundingMode: string;
  timeBillingMode: string;
  packagePriceMinor: string | null;
  packageDurationSeconds: number | null;
};

export type DevicePriceSummaryAssignment = {
  pricingPlanId: string;
  scopeType: string;
  scopeId: string;
  status: string;
};

export type DeviceHourlyPriceRow = {
  scopeType: string;
  deviceId: string;
  deviceName: string;
  planId: string;
  planName: string;
  currency: string;
  rateMinor: string | null;
  billingUnitSeconds: number | null;
  roundingMode: string;
  timeBillingMode: string;
};

export type DeviceOfferPriceRow = {
  planId: string;
  name: string;
  currency: string;
  packagePriceMinor: string | null;
  packageDurationSeconds: number | null;
  deviceIds: string[];
  deviceNames: string[];
};

export function uniqueDeviceIds(ids: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function targetLabel(
  assignment: DevicePriceSummaryAssignment,
  devicesById: Map<string, { id: string; name: string }>,
  typesById: Map<string, { id: string; name: string }>,
  fallback: string,
): string {
  if (assignment.scopeType === "DEVICE_TYPE") {
    return typesById.get(assignment.scopeId)?.name ?? fallback;
  }
  return devicesById.get(assignment.scopeId)?.name ?? fallback;
}

export function summarizeDeviceScopedPrices(input: {
  plans: DevicePriceSummaryPlan[];
  assignments: DevicePriceSummaryAssignment[];
  devices: Array<{ id: string; name: string }>;
  deviceTypes?: Array<{ id: string; name: string }>;
}): { hourly: DeviceHourlyPriceRow[]; offers: DeviceOfferPriceRow[] } {
  const devicesById = new Map(input.devices.map((device) => [device.id, device]));
  const typesById = new Map((input.deviceTypes ?? []).map((type) => [type.id, type]));
  const plansById = new Map(input.plans.map((plan) => [plan.id, plan]));
  const hourly: DeviceHourlyPriceRow[] = [];
  const offerMap = new Map<string, DeviceOfferPriceRow>();

  for (const assignment of input.assignments) {
    if (assignment.status !== "ACTIVE") continue;
    if (assignment.scopeType !== "DEVICE" && assignment.scopeType !== "DEVICE_TYPE") continue;
    const plan = plansById.get(assignment.pricingPlanId);
    if (!plan || plan.status !== "ACTIVE") continue;
    const deviceName = targetLabel(assignment, devicesById, typesById, plan.name);
    if (plan.pricingModel === "TIME_BASED") {
      hourly.push({
        scopeType: assignment.scopeType,
        deviceId: assignment.scopeId,
        deviceName,
        planId: plan.id,
        planName: plan.name,
        currency: plan.currency,
        rateMinor: plan.rateMinor,
        billingUnitSeconds: plan.billingUnitSeconds,
        roundingMode: plan.roundingMode,
        timeBillingMode: plan.timeBillingMode,
      });
      continue;
    }
    if (plan.pricingModel !== "PACKAGE") continue;
    const existing = offerMap.get(plan.id);
    if (existing) {
      existing.deviceIds.push(assignment.scopeId);
      existing.deviceNames.push(deviceName);
      continue;
    }
    offerMap.set(plan.id, {
      planId: plan.id,
      name: plan.name,
      currency: plan.currency,
      packagePriceMinor: plan.packagePriceMinor,
      packageDurationSeconds: plan.packageDurationSeconds,
      deviceIds: [assignment.scopeId],
      deviceNames: [deviceName],
    });
  }

  return { hourly, offers: [...offerMap.values()] };
}
