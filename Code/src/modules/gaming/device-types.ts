import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, isUniqueViolation } from "@/core/errors";
import { insertWithAllocatedCode, optionalInternalCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import {
  gamingDeviceTypes,
  gamingDevices,
  gamingPricingAssignments,
  gamingSessions,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { requireBranchAccess } from "./access";
import { likeSafe, normalizeOptionalText, normalizeRequiredName } from "./normalize";

export const DEVICE_TYPE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type DeviceTypeStatus = (typeof DEVICE_TYPE_STATUSES)[number];

export const createDeviceTypeInputSchema = z.object({
  code: z.string().max(32).optional(),
  name: z.string().min(1).max(200),
  category: z.string().max(64).optional().nullable(),
});

export type CreateDeviceTypeInput = z.infer<typeof createDeviceTypeInputSchema>;

export const updateDeviceTypeInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    category: z.string().max(64).nullable().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdateDeviceTypeInput = z.infer<typeof updateDeviceTypeInputSchema>;

export const listDeviceTypesInputSchema = z.object({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListDeviceTypesInput = z.infer<typeof listDeviceTypesInputSchema>;

export type DeviceTypeRecord = typeof gamingDeviceTypes.$inferSelect;

function snapshot(row: DeviceTypeRecord) {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    status: row.status,
  };
}

async function loadOwnDeviceType(
  tx: AppDatabase,
  organizationId: string,
  deviceTypeId: string,
): Promise<DeviceTypeRecord> {
  const rows = await tx
    .select()
    .from(gamingDeviceTypes)
    .where(and(eq(gamingDeviceTypes.id, deviceTypeId), eq(gamingDeviceTypes.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Device type not found");
  return row;
}

export async function listDeviceTypes(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListDeviceTypesInput = {},
): Promise<DeviceTypeRecord[]> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  const limit = input.limit ?? 100;
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const filters = [eq(gamingDeviceTypes.organizationId, actor.organizationId)];
    if (input.status) {
      filters.push(eq(gamingDeviceTypes.status, input.status));
    } else {
      filters.push(eq(gamingDeviceTypes.status, "ACTIVE"));
    }
    const q = input.q?.trim() ?? "";
    const safe = likeSafe(q);
    if (safe) {
      const pattern = `%${safe}%`;
      filters.push(
        or(
          ilike(gamingDeviceTypes.code, pattern),
          ilike(gamingDeviceTypes.name, pattern),
          ilike(gamingDeviceTypes.category, pattern),
        )!,
      );
    }
    return tx
      .select()
      .from(gamingDeviceTypes)
      .where(and(...filters))
      .orderBy(asc(gamingDeviceTypes.code))
      .limit(limit);
  });
}

export async function getDeviceType(
  db: AppDatabase,
  actor: OrganizationActor,
  deviceTypeId: string,
): Promise<DeviceTypeRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    loadOwnDeviceType(tx, actor.organizationId, deviceTypeId),
  );
}

export async function createDeviceType(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreateDeviceTypeInput,
): Promise<DeviceTypeRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  const name = normalizeRequiredName(input.name);
  const category = normalizeOptionalText(input.category, 64);
  const deviceTypeId = createId();
  const explicitCode = optionalInternalCode(input.code);

  return insertWithAllocatedCode({
    explicit: explicitCode,
    prefix: "T-",
    label: "Device type code",
    conflictMessage: "Device type code is already in use in this organization",
    isUniqueViolation,
    insert: async (code) =>
      withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
        const inserted = await tx
          .insert(gamingDeviceTypes)
          .values({
            id: deviceTypeId,
            organizationId: actor.organizationId,
            code,
            name,
            category,
            status: "ACTIVE",
          })
          .returning();
        const deviceType = inserted[0]!;
        await recordAudit(tx, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          action: "gaming.device_type.created",
          entityType: "gaming_device_type",
          entityId: deviceTypeId,
          after: snapshot(deviceType),
        });
        return deviceType;
      }),
  });
}

export async function updateDeviceType(
  db: AppDatabase,
  actor: OrganizationActor,
  deviceTypeId: string,
  input: UpdateDeviceTypeInput,
): Promise<DeviceTypeRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  const nextName = input.name !== undefined ? normalizeRequiredName(input.name) : undefined;
  const nextCategory =
    input.category !== undefined ? normalizeOptionalText(input.category, 64) : undefined;

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnDeviceType(tx, actor.organizationId, deviceTypeId);
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Archived device type cannot be updated");
    }
    const patch = {
      name: nextName ?? before.name,
      category: nextCategory === undefined ? before.category : nextCategory,
    };
    const updated = await tx
      .update(gamingDeviceTypes)
      .set(patch)
      .where(and(eq(gamingDeviceTypes.id, deviceTypeId), eq(gamingDeviceTypes.organizationId, actor.organizationId)))
      .returning();
    const deviceType = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gaming.device_type.updated",
      entityType: "gaming_device_type",
      entityId: deviceTypeId,
      before: snapshot(before),
      after: snapshot(deviceType),
    });
    return deviceType;
  });
}

export async function archiveDeviceType(
  db: AppDatabase,
  actor: OrganizationActor,
  deviceTypeId: string,
): Promise<DeviceTypeRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnDeviceType(tx, actor.organizationId, deviceTypeId);
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Device type is already archived");
    }
    const updated = await tx
      .update(gamingDeviceTypes)
      .set({ status: "ARCHIVED" })
      .where(and(eq(gamingDeviceTypes.id, deviceTypeId), eq(gamingDeviceTypes.organizationId, actor.organizationId)))
      .returning();
    const deviceType = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gaming.device_type.archived",
      entityType: "gaming_device_type",
      entityId: deviceTypeId,
      before: { status: before.status },
      after: { status: "ARCHIVED" },
    });
    return deviceType;
  });
}

export const DEVICE_TYPE_IN_USE_REASON = "device_type_in_use";
const DEVICE_TYPE_IN_USE_MESSAGE = "This device type cannot be disabled while stations are in use";

const OCCUPYING_SESSION_STATUSES = ["ACTIVE", "PAUSED", "ENDING"] as const;

/**
 * Wizard uncheck: archive the type and its unoccupied stations together.
 * Does not hard-delete. Refuses when any station of this type is in play.
 */
export async function archiveWizardDeviceType(
  db: AppDatabase,
  actor: OrganizationActor,
  deviceTypeId: string,
): Promise<DeviceTypeRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnDeviceType(tx, actor.organizationId, deviceTypeId);
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Device type is already archived");
    }

    const stations = await tx
      .select()
      .from(gamingDevices)
      .where(
        and(
          eq(gamingDevices.organizationId, actor.organizationId),
          eq(gamingDevices.deviceTypeId, deviceTypeId),
          isNull(gamingDevices.archivedAt),
        ),
      );

    for (const station of stations) {
      requireBranchAccess(actor, station.branchId, "MANAGE");
    }

    const stationIds = stations.map((station) => station.id);
    if (stationIds.length > 0) {
      const occupying = await tx
        .select({ id: gamingSessions.id })
        .from(gamingSessions)
        .where(
          and(
            eq(gamingSessions.organizationId, actor.organizationId),
            inArray(gamingSessions.currentDeviceId, stationIds),
            inArray(gamingSessions.status, [...OCCUPYING_SESSION_STATUSES]),
          ),
        )
        .limit(1);
      if (occupying[0]) {
        throw new ConflictError(DEVICE_TYPE_IN_USE_MESSAGE, DEVICE_TYPE_IN_USE_REASON);
      }
    }

    const archivedAt = new Date();
    for (const station of stations) {
      const updated = await tx
        .update(gamingDevices)
        .set({ archivedAt })
        .where(and(eq(gamingDevices.id, station.id), eq(gamingDevices.organizationId, actor.organizationId)))
        .returning();
      const device = updated[0]!;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        branchId: device.branchId,
        actorUserId: actor.userId,
        action: "gaming.device.archived",
        entityType: "gaming_device",
        entityId: station.id,
        before: { archivedAt: null, operationalStatus: station.operationalStatus },
        after: { archivedAt: device.archivedAt?.toISOString() ?? null },
        metadata: { name: station.name, wizard: true },
      });
    }

    await tx
      .update(gamingPricingAssignments)
      .set({ status: "INACTIVE" })
      .where(
        and(
          eq(gamingPricingAssignments.organizationId, actor.organizationId),
          eq(gamingPricingAssignments.scopeType, "DEVICE_TYPE"),
          eq(gamingPricingAssignments.scopeId, deviceTypeId),
          eq(gamingPricingAssignments.status, "ACTIVE"),
        ),
      );

    const updated = await tx
      .update(gamingDeviceTypes)
      .set({ status: "ARCHIVED" })
      .where(and(eq(gamingDeviceTypes.id, deviceTypeId), eq(gamingDeviceTypes.organizationId, actor.organizationId)))
      .returning();
    const deviceType = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gaming.device_type.archived",
      entityType: "gaming_device_type",
      entityId: deviceTypeId,
      before: { status: before.status, name: before.name },
      after: { status: "ARCHIVED", name: deviceType.name },
      metadata: { wizard: true, archivedDeviceCount: stations.length },
    });
    return deviceType;
  });
}
