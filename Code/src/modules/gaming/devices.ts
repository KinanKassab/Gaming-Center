import { and, asc, eq, ilike, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, isForeignKeyViolation, isUniqueViolation } from "@/core/errors";
import { insertWithAllocatedCode, optionalInternalCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import { gamingAreas, gamingDeviceTypes, gamingDevices } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { grantedBranchIds, requireActiveBranch, requireBranchAccess } from "./access";
import { likeSafe, normalizeOptionalText, normalizeRequiredName, uuidPattern } from "./normalize";

export const DEVICE_OPERATIONAL_STATUSES = ["ENABLED", "MAINTENANCE", "DISABLED"] as const;
export type DeviceOperationalStatus = (typeof DEVICE_OPERATIONAL_STATUSES)[number];

export const createDeviceInputSchema = z.object({
  branchId: z.string().regex(uuidPattern, "Invalid branch id"),
  areaId: z.string().regex(uuidPattern, "Invalid area id"),
  deviceTypeId: z.string().regex(uuidPattern, "Invalid device type id"),
  code: z.string().max(32).optional(),
  name: z.string().min(1).max(200),
  operationalStatus: z.enum(["ENABLED", "MAINTENANCE", "DISABLED"]).optional(),
  notes: z.string().max(4000).optional().nullable(),
  sortOrder: z.coerce.number().int().min(-100000).max(100000).optional(),
});

export type CreateDeviceInput = z.infer<typeof createDeviceInputSchema>;

export const updateDeviceInputSchema = z
  .object({
    areaId: z.string().regex(uuidPattern, "Invalid area id").optional(),
    deviceTypeId: z.string().regex(uuidPattern, "Invalid device type id").optional(),
    name: z.string().min(1).max(200).optional(),
    operationalStatus: z.enum(["ENABLED", "MAINTENANCE", "DISABLED"]).optional(),
    notes: z.string().max(4000).nullable().optional(),
    sortOrder: z.coerce.number().int().min(-100000).max(100000).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdateDeviceInput = z.infer<typeof updateDeviceInputSchema>;

export const listDevicesInputSchema = z.object({
  branchId: z.string().regex(uuidPattern, "Invalid branch id").optional(),
  areaId: z.string().regex(uuidPattern, "Invalid area id").optional(),
  deviceTypeId: z.string().regex(uuidPattern, "Invalid device type id").optional(),
  operationalStatus: z.enum(["ENABLED", "MAINTENANCE", "DISABLED"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListDevicesInput = z.infer<typeof listDevicesInputSchema>;

export type DeviceRecord = typeof gamingDevices.$inferSelect;

function snapshot(row: DeviceRecord) {
  return {
    branchId: row.branchId,
    areaId: row.areaId,
    deviceTypeId: row.deviceTypeId,
    code: row.code,
    name: row.name,
    operationalStatus: row.operationalStatus,
    notes: row.notes,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

async function loadOwnDevice(
  tx: AppDatabase,
  organizationId: string,
  deviceId: string,
): Promise<DeviceRecord> {
  const rows = await tx
    .select()
    .from(gamingDevices)
    .where(and(eq(gamingDevices.id, deviceId), eq(gamingDevices.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Device not found");
  return row;
}

async function requireUsableArea(
  tx: AppDatabase,
  organizationId: string,
  branchId: string,
  areaId: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(gamingAreas)
    .where(and(eq(gamingAreas.id, areaId), eq(gamingAreas.organizationId, organizationId)))
    .limit(1);
  const area = rows[0];
  if (!area) throw new NotFoundError("Area not found");
  if (area.branchId !== branchId) {
    throw new ValidationError("Area does not belong to this branch");
  }
  if (area.status === "ARCHIVED") {
    throw new ConflictError("Area is archived");
  }
}

async function requireUsableDeviceType(
  tx: AppDatabase,
  organizationId: string,
  deviceTypeId: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(gamingDeviceTypes)
    .where(and(eq(gamingDeviceTypes.id, deviceTypeId), eq(gamingDeviceTypes.organizationId, organizationId)))
    .limit(1);
  const deviceType = rows[0];
  if (!deviceType) throw new NotFoundError("Device type not found");
  if (deviceType.status === "ARCHIVED") {
    throw new ConflictError("Device type is archived");
  }
}

export async function listDevices(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListDevicesInput = {},
): Promise<DeviceRecord[]> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  const limit = input.limit ?? 100;
  if (input.branchId) {
    requireBranchAccess(actor, input.branchId, "VIEW");
  }
  const visible = input.branchId ? [input.branchId] : grantedBranchIds(actor, "VIEW");
  if (visible.length === 0) return [];

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const filters = [
      eq(gamingDevices.organizationId, actor.organizationId),
      inArray(gamingDevices.branchId, visible),
    ];
    if (input.areaId) filters.push(eq(gamingDevices.areaId, input.areaId));
    if (input.deviceTypeId) filters.push(eq(gamingDevices.deviceTypeId, input.deviceTypeId));
    if (input.operationalStatus) {
      filters.push(eq(gamingDevices.operationalStatus, input.operationalStatus));
    }
    if (input.archived === "true") {
      filters.push(isNotNull(gamingDevices.archivedAt));
    } else {
      filters.push(isNull(gamingDevices.archivedAt));
    }
    const q = input.q?.trim() ?? "";
    const safe = likeSafe(q);
    if (safe) {
      const pattern = `%${safe}%`;
      filters.push(or(ilike(gamingDevices.code, pattern), ilike(gamingDevices.name, pattern))!);
    }
    return tx
      .select()
      .from(gamingDevices)
      .where(and(...filters))
      .orderBy(asc(gamingDevices.sortOrder), asc(gamingDevices.code))
      .limit(limit);
  });
}

export async function getDevice(
  db: AppDatabase,
  actor: OrganizationActor,
  deviceId: string,
): Promise<DeviceRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const device = await loadOwnDevice(tx, actor.organizationId, deviceId);
    requireBranchAccess(actor, device.branchId, "VIEW");
    return device;
  });
}

export async function createDevice(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreateDeviceInput,
): Promise<DeviceRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  requireBranchAccess(actor, input.branchId, "MANAGE");
  const name = normalizeRequiredName(input.name);
  const notes = normalizeOptionalText(input.notes, 4000);
  const operationalStatus = input.operationalStatus ?? "ENABLED";
  const sortOrder = input.sortOrder ?? 0;
  const deviceId = createId();
  const explicitCode = optionalInternalCode(input.code);

  try {
    return await insertWithAllocatedCode({
      explicit: explicitCode,
      prefix: "D-",
      label: "Device code",
      conflictMessage: "Device code is already in use in this branch",
      isUniqueViolation,
      insert: async (code) =>
        withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
          await requireActiveBranch(tx, actor.organizationId, input.branchId);
          await requireUsableArea(tx, actor.organizationId, input.branchId, input.areaId);
          await requireUsableDeviceType(tx, actor.organizationId, input.deviceTypeId);
          const inserted = await tx
            .insert(gamingDevices)
            .values({
              id: deviceId,
              organizationId: actor.organizationId,
              branchId: input.branchId,
              areaId: input.areaId,
              deviceTypeId: input.deviceTypeId,
              code,
              name,
              operationalStatus,
              notes,
              sortOrder,
            })
            .returning();
          const device = inserted[0]!;
          await recordAudit(tx, {
            organizationId: actor.organizationId,
            branchId: input.branchId,
            actorUserId: actor.userId,
            action: "gaming.device.created",
            entityType: "gaming_device",
            entityId: deviceId,
            after: snapshot(device),
          });
          return device;
        }),
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ValidationError("Invalid branch, area, or device type for this organization");
    }
    throw error;
  }
}

export async function updateDevice(
  db: AppDatabase,
  actor: OrganizationActor,
  deviceId: string,
  input: UpdateDeviceInput,
): Promise<DeviceRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  const nextName = input.name !== undefined ? normalizeRequiredName(input.name) : undefined;
  const nextNotes = input.notes !== undefined ? normalizeOptionalText(input.notes, 4000) : undefined;

  try {
    return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      const before = await loadOwnDevice(tx, actor.organizationId, deviceId);
      requireBranchAccess(actor, before.branchId, "MANAGE");
      if (before.archivedAt) {
        throw new ConflictError("Archived device cannot be updated");
      }
      const areaId = input.areaId ?? before.areaId;
      const deviceTypeId = input.deviceTypeId ?? before.deviceTypeId;
      if (input.areaId) {
        await requireUsableArea(tx, actor.organizationId, before.branchId, areaId);
      }
      if (input.deviceTypeId) {
        await requireUsableDeviceType(tx, actor.organizationId, deviceTypeId);
      }
      const patch = {
        areaId,
        deviceTypeId,
        name: nextName ?? before.name,
        operationalStatus: input.operationalStatus ?? before.operationalStatus,
        notes: nextNotes === undefined ? before.notes : nextNotes,
        sortOrder: input.sortOrder ?? before.sortOrder,
      };
      const updated = await tx
        .update(gamingDevices)
        .set(patch)
        .where(and(eq(gamingDevices.id, deviceId), eq(gamingDevices.organizationId, actor.organizationId)))
        .returning();
      const device = updated[0]!;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        branchId: device.branchId,
        actorUserId: actor.userId,
        action: "gaming.device.updated",
        entityType: "gaming_device",
        entityId: deviceId,
        before: snapshot(before),
        after: snapshot(device),
      });
      return device;
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ValidationError("Invalid area or device type for this organization");
    }
    throw error;
  }
}

export async function archiveDevice(
  db: AppDatabase,
  actor: OrganizationActor,
  deviceId: string,
): Promise<DeviceRecord> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnDevice(tx, actor.organizationId, deviceId);
    requireBranchAccess(actor, before.branchId, "MANAGE");
    if (before.archivedAt) {
      throw new ConflictError("Device is already archived");
    }
    const updated = await tx
      .update(gamingDevices)
      .set({ archivedAt: new Date() })
      .where(and(eq(gamingDevices.id, deviceId), eq(gamingDevices.organizationId, actor.organizationId)))
      .returning();
    const device = updated[0]!;
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: device.branchId,
      actorUserId: actor.userId,
      action: "gaming.device.archived",
      entityType: "gaming_device",
      entityId: deviceId,
      before: { archivedAt: null, operationalStatus: before.operationalStatus },
      after: { archivedAt: device.archivedAt?.toISOString() ?? null },
    });
    return device;
  });
}
