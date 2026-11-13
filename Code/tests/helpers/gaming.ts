import { createBranch } from "@/modules/identity";
import {
  createArea,
  createDevice,
  createDeviceType,
  createPricingAssignment,
  createPricingPlan,
  type PricingPlanRecord,
} from "@/modules/gaming";
import { createId } from "@/core/ids";
import { PRORATED_SNAPSHOT_FIELDS, TIME_BILLING_PRORATED_HOUR } from "@/modules/gaming/billing-prorated";
import { gamingSessionPauses, gamingSessionSegments, gamingSessions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { resolveActor, type SeededOwner, type TestEnvironment } from "./identity";
import type { OrganizationActor } from "@/modules/identity/types";

export async function refreshOwnerActor(env: TestEnvironment, owner: SeededOwner) {
  return resolveActor(env, owner.headers, owner.organizationId);
}

export function pricingSnapshotFromPlan(
  plan: PricingPlanRecord,
  options?: { assignmentId?: string; capturedAt?: Date },
) {
  const prorated = plan.timeBillingMode === TIME_BILLING_PRORATED_HOUR;
  return {
    assignmentId: options?.assignmentId ?? createId(),
    pricingPlanId: plan.id,
    code: plan.code,
    name: plan.name,
    pricingModel: plan.pricingModel,
    currency: plan.currency,
    rateMinor: plan.rateMinor == null ? null : plan.rateMinor.toString(),
    billingUnitSeconds: plan.billingUnitSeconds,
    roundingMode: plan.roundingMode,
    minimumBillableSeconds: plan.minimumBillableSeconds,
    minimumChargeMinor: plan.minimumChargeMinor.toString(),
    packageDurationSeconds: plan.packageDurationSeconds,
    packagePriceMinor: plan.packagePriceMinor == null ? null : plan.packagePriceMinor.toString(),
    capturedAt: (options?.capturedAt ?? new Date("2026-01-01T00:00:00.000Z")).toISOString(),
    timeBillingMode: prorated ? TIME_BILLING_PRORATED_HOUR : "UNIT",
    ...(prorated ? PRORATED_SNAPSHOT_FIELDS : {}),
  };
}

export async function seedBranchAreaAndType(
  env: TestEnvironment,
  owner: SeededOwner,
  options?: { branchCode?: string; branchName?: string; areaCode?: string; typeCode?: string },
) {
  let context = await resolveActor(env, owner.headers, owner.organizationId);
  const branch = await createBranch(env.db, context.actor, {
    code: options?.branchCode ?? "JRM",
    name:
      options?.branchName ??
      (options?.branchCode ? `Jaramana ${options.branchCode}` : "Jaramana"),
  });
  context = await resolveActor(env, owner.headers, owner.organizationId);
  const deviceType = await createDeviceType(env.db, context.actor, {
    code: options?.typeCode ?? "PC",
    name: "PC station",
    category: "PC",
  });
  const area = await createArea(env.db, context.actor, {
    branchId: branch.id,
    code: options?.areaCode ?? "MAIN",
    name: "Main Hall",
  });
  return { context, branch, deviceType, area };
}

export async function seedPlayableDevice(
  env: TestEnvironment,
  owner: SeededOwner,
  options?: {
    branchCode?: string;
    deviceCode?: string;
    rateMinor?: number;
  },
) {
  const seeded = await seedBranchAreaAndType(
    env,
    owner,
    options?.branchCode ? { branchCode: options.branchCode } : undefined,
  );
  const plan = await createPricingPlan(env.db, seeded.context.actor, {
    code: "STD",
    name: "Standard PC",
    pricingModel: "TIME_BASED",
    rateMinor: options?.rateMinor ?? 100,
    billingUnitSeconds: 60,
    roundingMode: "CEIL",
  });
  const device = await createDevice(env.db, seeded.context.actor, {
    branchId: seeded.branch.id,
    areaId: seeded.area.id,
    deviceTypeId: seeded.deviceType.id,
    code: options?.deviceCode ?? "PC07",
    name: "PC 07",
  });
  await createPricingAssignment(env.db, seeded.context.actor, {
    pricingPlanId: plan.id,
    scopeType: "DEVICE",
    branchId: seeded.branch.id,
    scopeId: device.id,
  });
  return { ...seeded, device, plan };
}

export async function insertCompletedUnbilledSession(
  env: TestEnvironment,
  actor: OrganizationActor,
  input: {
    branchId: string;
    deviceId: string;
    plan: PricingPlanRecord;
    startedAt: Date;
    endedAt: Date;
    sessionNumber?: string;
    sessionType?: "OPEN" | "FIXED";
    requestedEndAt?: Date;
    customerId?: string;
    pauses?: Array<{ startedAt: Date; endedAt: Date; isBillable?: boolean }>;
    extraSegments?: Array<{
      deviceId: string;
      plan: PricingPlanRecord;
      startedAt: Date;
      endedAt: Date;
      endReason?: "MOVE" | "PRICE_CHANGE" | "SESSION_END";
    }>;
  },
) {
  const sessionId = createId();
  const snapshot = pricingSnapshotFromPlan(input.plan, { capturedAt: input.startedAt });
  const firstEnd = input.extraSegments?.[0]?.startedAt ?? input.endedAt;
  await withTenant(env.db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    await tx.insert(gamingSessions).values({
      id: sessionId,
      organizationId: actor.organizationId,
      branchId: input.branchId,
      sessionNumber: input.sessionNumber ?? String(Date.now()),
      sessionType: input.sessionType ?? "OPEN",
      status: "COMPLETED",
      currentDeviceId: null,
      customerId: input.customerId ?? null,
      startedAt: input.startedAt,
      requestedEndAt: input.requestedEndAt ?? null,
      endedAt: input.endedAt,
      createdBy: actor.userId,
      closedBy: actor.userId,
    });
    await tx.insert(gamingSessionSegments).values({
      id: createId(),
      organizationId: actor.organizationId,
      branchId: input.branchId,
      sessionId,
      deviceId: input.deviceId,
      pricingPlanId: input.plan.id,
      startedAt: input.startedAt,
      endedAt: firstEnd,
      endReason: input.extraSegments?.length ? "MOVE" : "SESSION_END",
      pricingSnapshot: snapshot,
    });
    for (const [index, segment] of (input.extraSegments ?? []).entries()) {
      const last = index === (input.extraSegments?.length ?? 0) - 1;
      await tx.insert(gamingSessionSegments).values({
        id: createId(),
        organizationId: actor.organizationId,
        branchId: input.branchId,
        sessionId,
        deviceId: segment.deviceId,
        pricingPlanId: segment.plan.id,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        endReason: segment.endReason ?? (last ? "SESSION_END" : "MOVE"),
        pricingSnapshot: pricingSnapshotFromPlan(segment.plan, { capturedAt: segment.startedAt }),
      });
    }
    for (const pause of input.pauses ?? []) {
      await tx.insert(gamingSessionPauses).values({
        id: createId(),
        organizationId: actor.organizationId,
        branchId: input.branchId,
        sessionId,
        startedAt: pause.startedAt,
        endedAt: pause.endedAt,
        isBillable: pause.isBillable ?? false,
        createdBy: actor.userId,
      });
    }
  });
  return sessionId;
}
