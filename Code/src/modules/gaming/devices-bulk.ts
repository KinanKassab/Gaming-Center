import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, isForeignKeyViolation, isUniqueViolation } from "@/core/errors";
import { allocateInternalCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import { coreBranches, gamingAreas, gamingDeviceTypes, gamingDevices } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { requireBranchAccess } from "./access";
import { normalizeOptionalText, uuidPattern } from "./normalize";
import { DEVICE_OPERATIONAL_STATUSES, type DeviceRecord } from "./devices";
import { previewBulkDeviceNames } from "./device-names";
import { BULK_DEVICE_MAX_COUNT } from "./device-names-limit";

export { previewBulkDeviceNames } from "./device-names";
export { BULK_DEVICE_MAX_COUNT } from "./device-names-limit";

export const createDevicesBulkInputSchema = z.object({
  branchId: z.string().regex(uuidPattern, "Invalid branch id"),
  areaId: z.string().regex(uuidPattern, "Invalid area id"),
  deviceTypeId: z.string().regex(uuidPattern, "Invalid device type id"),
  count: z.coerce.number().int().min(1, "Create at least one device").max(BULK_DEVICE_MAX_COUNT, `Create at most ${BULK_DEVICE_MAX_COUNT} devices at once`),
  namePrefix: z.string().max(160).optional().nullable(),
  operationalStatus: z.enum(DEVICE_OPERATIONAL_STATUSES).optional(),
  notes: z.string().max(4000).optional().nullable(),
});

export type CreateDevicesBulkInput = z.infer<typeof createDevicesBulkInputSchema>;

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

export async function createDevicesBulk(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreateDevicesBulkInput,
): Promise<DeviceRecord[]> {
  assertPermission(actor, PERMISSIONS.gamingMasterManage);
  requireBranchAccess(actor, input.branchId, "MANAGE");
  const operationalStatus = input.operationalStatus ?? "ENABLED";
  const notes = normalizeOptionalText(input.notes, 4000);
  const namePrefix = input.namePrefix?.trim() || null;

  try {
    return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      const branchRows = await tx
        .select({ id: coreBranches.id, status: coreBranches.status })
        .from(coreBranches)
        .where(and(eq(coreBranches.id, input.branchId), eq(coreBranches.organizationId, actor.organizationId)))
        .for("update")
        .limit(1);
      const branch = branchRows[0];
      if (!branch) throw new NotFoundError("Branch not found in this organization");
      if (branch.status === "ARCHIVED") throw new ConflictError("Branch is archived");

      const areaRows = await tx
        .select()
        .from(gamingAreas)
        .where(and(eq(gamingAreas.id, input.areaId), eq(gamingAreas.organizationId, actor.organizationId)))
        .limit(1);
      const area = areaRows[0];
      if (!area) throw new NotFoundError("Area not found");
      if (area.branchId !== input.branchId) {
        throw new ValidationError("Area does not belong to this branch");
      }
      if (area.status === "ARCHIVED") throw new ConflictError("Area is archived");

      const typeRows = await tx
        .select()
        .from(gamingDeviceTypes)
        .where(
          and(
            eq(gamingDeviceTypes.id, input.deviceTypeId),
            eq(gamingDeviceTypes.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      const deviceType = typeRows[0];
      if (!deviceType) throw new NotFoundError("Device type not found");
      if (deviceType.status === "ARCHIVED") throw new ConflictError("Device type is archived");

      const existing = await tx
        .select({ code: gamingDevices.code, name: gamingDevices.name, deviceTypeId: gamingDevices.deviceTypeId })
        .from(gamingDevices)
        .where(
          and(
            eq(gamingDevices.organizationId, actor.organizationId),
            eq(gamingDevices.branchId, input.branchId),
          ),
        );

      const names = previewBulkDeviceNames({
        deviceTypeName: deviceType.name,
        namePrefix,
        count: input.count,
        existingNames: existing
          .filter((row) => row.deviceTypeId === input.deviceTypeId)
          .map((row) => row.name),
      });

      const usedCodes = new Set(existing.map((row) => row.code));
      const rows = names.map((name, index) => {
        let code = allocateInternalCode("D-");
        let attempt = 0;
        while (usedCodes.has(code)) {
          attempt += 1;
          if (attempt > 8) {
            throw new ConflictError("Could not allocate a unique device code. Try again.");
          }
          code = allocateInternalCode("D-");
        }
        usedCodes.add(code);
        return {
          id: createId(),
          organizationId: actor.organizationId,
          branchId: input.branchId,
          areaId: input.areaId,
          deviceTypeId: input.deviceTypeId,
          code,
          name,
          operationalStatus,
          notes,
          sortOrder: index,
        };
      });

      const inserted = await tx.insert(gamingDevices).values(rows).returning();
      const deviceIds = inserted.map((row) => row.id);

      for (const device of inserted) {
        await recordAudit(tx, {
          organizationId: actor.organizationId,
          branchId: input.branchId,
          actorUserId: actor.userId,
          action: "gaming.device.created",
          entityType: "gaming_device",
          entityId: device.id,
          after: snapshot(device),
          metadata: { batch: true, batchSize: inserted.length },
        });
      }
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        actorUserId: actor.userId,
        action: "gaming.device.bulk_created",
        entityType: "gaming_device",
        entityId: deviceIds[0] ?? null,
        after: { count: inserted.length, deviceIds },
      });

      const ordered = await tx
        .select()
        .from(gamingDevices)
        .where(and(eq(gamingDevices.organizationId, actor.organizationId), inArray(gamingDevices.id, deviceIds)));
      const byId = new Map(ordered.map((row) => [row.id, row]));
      return rows.map((row) => byId.get(row.id)!);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A device code in this batch is already in use. Try again.");
    }
    if (isForeignKeyViolation(error)) {
      throw new ValidationError("Invalid branch, area, or device type for this organization");
    }
    throw error;
  }
}
