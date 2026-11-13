import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { assertPermission } from "@/core/tenancy";
import { isPositiveHourlyRate } from "@/ui/hall-hourly-price";
import {
  coreCustomers,
  gamingAreas,
  gamingDeviceTypes,
  gamingDevices,
  gamingSessionPauses,
  gamingSessions,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { grantedBranchIds, requireBranchAccess } from "./access";
import { uuidPattern } from "./normalize";
import { positiveHourlyRatesByDevice } from "./pricing-resolve";
import { serializeSession, type SessionJson } from "./sessions";

export const listFloorInputSchema = z.object({
  branchId: z.string().regex(uuidPattern, "Invalid branch id"),
  areaId: z.string().regex(uuidPattern, "Invalid area id").optional(),
  deviceTypeId: z.string().regex(uuidPattern, "Invalid device type id").optional(),
});

export type ListFloorInput = z.infer<typeof listFloorInputSchema>;

export type FloorOccupancy = "AVAILABLE" | "OCCUPIED" | "UNAVAILABLE";

export type FloorDevice = {
  deviceId: string;
  branchId: string;
  code: string;
  name: string;
  sortOrder: number;
  operationalStatus: string;
  occupancy: FloorOccupancy;
  /** Positive hourly rate in minor units. Absent when the station is shown only because it is occupied. */
  hourlyRateMinor: string | null;
  area: { id: string; code: string; name: string };
  deviceType: { id: string; code: string; name: string; category: string | null };
  session: null | {
    session: SessionJson;
    customerDisplayName: string | null;
    currentPauseStartedAt: string | null;
  };
};

/**
 * Accessible branches that currently have at least one priced (or occupied)
 * non-archived device. Used only to pick a Floor workspace default.
 */
export async function listBranchIdsWithFloorDevices(
  db: AppDatabase,
  actor: OrganizationActor,
  branchIds: readonly string[],
): Promise<string[]> {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
  const allowed = new Set(grantedBranchIds(actor, "VIEW"));
  const visible = branchIds.filter((id) => allowed.has(id));
  if (visible.length === 0) return [];

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const deviceRows = await tx
      .select({
        id: gamingDevices.id,
        organizationId: gamingDevices.organizationId,
        branchId: gamingDevices.branchId,
        areaId: gamingDevices.areaId,
        deviceTypeId: gamingDevices.deviceTypeId,
      })
      .from(gamingDevices)
      .where(
        and(
          eq(gamingDevices.organizationId, actor.organizationId),
          inArray(gamingDevices.branchId, visible),
          isNull(gamingDevices.archivedAt),
        ),
      );
    const deviceIds = deviceRows.map((row) => row.id);
    const occupying =
      deviceIds.length === 0
        ? []
        : await tx
            .select({ deviceId: gamingSessions.currentDeviceId })
            .from(gamingSessions)
            .where(
              and(
                eq(gamingSessions.organizationId, actor.organizationId),
                inArray(gamingSessions.currentDeviceId, deviceIds),
                inArray(gamingSessions.status, ["ACTIVE", "PAUSED"]),
              ),
            );
    const occupyingIds = new Set(
      occupying.map((row) => row.deviceId).filter((id): id is string => typeof id === "string"),
    );
    const pricedRates = await positiveHourlyRatesByDevice(tx, actor.organizationId, deviceRows, new Date());
    const pricedIds = new Set(pricedRates.keys());
    const present = new Set<string>();
    for (const row of deviceRows) {
      if (pricedIds.has(row.id) || occupyingIds.has(row.id)) present.add(row.branchId);
    }
    return visible.filter((id) => present.has(id));
  });
}

/**
 * Operational floor projection: device master data plus the at-most-one
 * ACTIVE/PAUSED session occupying that device. Occupancy is never stored
 * on gaming_devices.operational_status.
 */
export async function listFloor(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListFloorInput,
): Promise<FloorDevice[]> {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
  requireBranchAccess(actor, input.branchId, "VIEW");

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const deviceFilters = [
      eq(gamingDevices.organizationId, actor.organizationId),
      eq(gamingDevices.branchId, input.branchId),
      isNull(gamingDevices.archivedAt),
    ];
    if (input.areaId) deviceFilters.push(eq(gamingDevices.areaId, input.areaId));
    if (input.deviceTypeId) deviceFilters.push(eq(gamingDevices.deviceTypeId, input.deviceTypeId));

    const devices = await tx
      .select({
        device: gamingDevices,
        area: gamingAreas,
        deviceType: gamingDeviceTypes,
      })
      .from(gamingDevices)
      .innerJoin(
        gamingAreas,
        and(
          eq(gamingAreas.id, gamingDevices.areaId),
          eq(gamingAreas.organizationId, gamingDevices.organizationId),
        ),
      )
      .innerJoin(
        gamingDeviceTypes,
        and(
          eq(gamingDeviceTypes.id, gamingDevices.deviceTypeId),
          eq(gamingDeviceTypes.organizationId, gamingDevices.organizationId),
        ),
      )
      .where(and(...deviceFilters))
      .orderBy(asc(gamingAreas.sortOrder), asc(gamingDevices.sortOrder), asc(gamingDevices.code));

    const deviceIds = devices.map((row) => row.device.id);
    const occupying =
      deviceIds.length === 0
        ? []
        : await tx
            .select({
              session: gamingSessions,
              customerName: coreCustomers.displayName,
            })
            .from(gamingSessions)
            .leftJoin(
              coreCustomers,
              and(
                eq(coreCustomers.id, gamingSessions.customerId),
                eq(coreCustomers.organizationId, gamingSessions.organizationId),
              ),
            )
            .where(
              and(
                eq(gamingSessions.organizationId, actor.organizationId),
                eq(gamingSessions.branchId, input.branchId),
                inArray(gamingSessions.currentDeviceId, deviceIds),
                inArray(gamingSessions.status, ["ACTIVE", "PAUSED"]),
              ),
            );

    const sessionIds = occupying.map((row) => row.session.id);
    const openPauses =
      sessionIds.length === 0
        ? []
        : await tx
            .select()
            .from(gamingSessionPauses)
            .where(
              and(inArray(gamingSessionPauses.sessionId, sessionIds), isNull(gamingSessionPauses.endedAt)),
            );

    const sessionByDevice = new Map(occupying.map((row) => [row.session.currentDeviceId, row]));
    const pauseBySession = new Map(openPauses.map((row) => [row.sessionId, row]));
    const occupyingIds = new Set(
      occupying.map((row) => row.session.currentDeviceId).filter((id): id is string => typeof id === "string"),
    );
    const pricedRates = await positiveHourlyRatesByDevice(
      tx,
      actor.organizationId,
      devices.map((row) => row.device),
      new Date(),
    );
    const visibleDevices = devices.filter((row) => {
      const rate = pricedRates.get(row.device.id);
      const priced = isPositiveHourlyRate(rate);
      return priced || occupyingIds.has(row.device.id);
    });

    return visibleDevices.map(({ device, area, deviceType }) => {
      const occupyingRow = sessionByDevice.get(device.id);
      const occupancy: FloorOccupancy =
        device.operationalStatus !== "ENABLED"
          ? "UNAVAILABLE"
          : occupyingRow
            ? "OCCUPIED"
            : "AVAILABLE";
      const pause = occupyingRow ? pauseBySession.get(occupyingRow.session.id) : undefined;
      return {
        deviceId: device.id,
        branchId: device.branchId,
        code: device.code,
        name: device.name,
        sortOrder: device.sortOrder,
        operationalStatus: device.operationalStatus,
        occupancy,
        hourlyRateMinor: (() => {
          const rate = pricedRates.get(device.id);
          return isPositiveHourlyRate(rate) ? rate!.toString() : null;
        })(),
        area: { id: area.id, code: area.code, name: area.name },
        deviceType: {
          id: deviceType.id,
          code: deviceType.code,
          name: deviceType.name,
          category: deviceType.category,
        },
        session: occupyingRow
          ? {
              session: serializeSession(occupyingRow.session),
              customerDisplayName: occupyingRow.customerName ?? null,
              currentPauseStartedAt: pause ? pause.startedAt.toISOString() : null,
            }
          : null,
      };
    });
  });
}

/** Devices whose resolved hourly rate is positive. Used by the devices list. */
export async function listHallReadyDeviceIds(
  db: AppDatabase,
  actor: OrganizationActor,
  devices: ReadonlyArray<{
    id: string;
    organizationId: string;
    branchId: string;
    areaId: string;
    deviceTypeId: string;
  }>,
): Promise<Set<string>> {
  assertPermission(actor, PERMISSIONS.gamingMasterRead);
  if (devices.length === 0) return new Set();
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const rates = await positiveHourlyRatesByDevice(tx, actor.organizationId, devices, new Date());
    const ready = new Set<string>();
    for (const [id, rate] of rates) {
      if (isPositiveHourlyRate(rate)) ready.add(id);
    }
    return ready;
  });
}
