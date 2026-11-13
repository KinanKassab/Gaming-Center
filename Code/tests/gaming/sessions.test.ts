import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AuthorizationError, ConflictError, NotFoundError } from "@/core/errors";
import { createId } from "@/core/ids";
import { createBranch, listAuditLogs, PERMISSIONS } from "@/modules/identity";
import { createCustomer, archiveCustomer } from "@/modules/customers";
import { setOrganizationSetting } from "@/modules/settings";
import {
  assignSessionCustomer,
  archiveDevice,
  cancelSession,
  createDevice,
  createPricingAssignment,
  createPricingPlan,
  endSession,
  getSession,
  listAccessibleBranches,
  listFloor,
  listSessionBranches,
  listSessions,
  moveSession,
  pauseSession,
  resumeSession,
  startSession,
  updateDevice,
} from "@/modules/gaming";
import { coreOutboxEvents, gamingSessions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  createStaffMember,
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

const SESSION_PERMS = [
  PERMISSIONS.gamingSessionsRead,
  PERMISSIONS.gamingSessionsStart,
  PERMISSIONS.gamingSessionsOperate,
  PERMISSIONS.gamingSessionsCancel,
];

describe("gaming sessions", () => {
  it("starts, pauses, resumes, and ends a guest session with a pricing snapshot", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-life",
    });
    const { context, device, plan, branch } = await seedPlayableDevice(env, owner);
    const started = await startSession(env.db, context.actor, { deviceId: device.id });
    expect(started.status).toBe("ACTIVE");
    expect(started.customerId).toBeNull();
    expect(started.currentDeviceId).toBe(device.id);
    expect(started.sessionNumber).toBe("1");
    expect(started.gamingTotalMinor).toBeNull();

    const detail = await getSession(env.db, context.actor, started.id);
    expect(detail.segments).toHaveLength(1);
    expect(detail.segments[0]?.pricingPlanId).toBe(plan.id);
    const snapshot = detail.segments[0]?.pricingSnapshot as { rateMinor?: string; capturedAt?: string };
    expect(snapshot.rateMinor).toBe("100");
    expect(snapshot.capturedAt).toBeTruthy();

    const paused = await pauseSession(env.db, context.actor, started.id, { reason: "break" });
    expect(paused.status).toBe("PAUSED");
    await expect(resumeSession(env.db, context.actor, started.id)).resolves.toMatchObject({ status: "ACTIVE" });
    const ended = await endSession(env.db, context.actor, started.id);
    expect(ended.status).toBe("COMPLETED");
    expect(ended.currentDeviceId).toBeNull();
    expect(ended.endedAt).toBeTruthy();
    expect(ended.gamingTotalMinor).toBe("0");

    const closed = await getSession(env.db, context.actor, started.id);
    expect(closed.segments[0]?.endReason).toBe("SESSION_END");
    expect(closed.pauses).toHaveLength(1);
    expect(closed.pauses[0]?.isBillable).toBe(false);
    expect(closed.pauses[0]?.endedAt).toBeTruthy();

    const floor = await listFloor(env.db, context.actor, { branchId: branch.id });
    expect(floor[0]?.occupancy).toBe("AVAILABLE");

    const audit = await listAuditLogs(env.db, context.actor, { limit: 20 });
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "gaming.session.started",
        "gaming.session.paused",
        "gaming.session.resumed",
        "gaming.session.ended",
        "gaming.session.billing_finalized",
      ]),
    );

    const outbox = await withTenant(env.db, owner.organizationId, (tx) =>
      tx.select().from(coreOutboxEvents).where(eq(coreOutboxEvents.aggregateId, started.id)),
    );
    expect(outbox.map((row) => row.eventType).sort()).toEqual([
      "gaming.session.billing_finalized",
      "gaming.session.completed",
      "gaming.session.paused",
      "gaming.session.resumed",
      "gaming.session.started",
    ]);
  });

  it("starts a session when the matching assignment has a future validTo", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-valid-to",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const extra = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC-VT",
      name: "Valid-to PC",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: seeded.plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: extra.id,
      validTo: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const started = await startSession(env.db, seeded.context.actor, { deviceId: extra.id });
    expect(started.status).toBe("ACTIVE");
    expect(started.currentDeviceId).toBe(extra.id);
    const detail = await getSession(env.db, seeded.context.actor, started.id);
    expect(detail.segments[0]?.pricingPlanId).toBe(seeded.plan.id);
  });

  it("rejects invalid transitions and a second start on an occupied device", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-invalid",
    });
    const { context, device } = await seedPlayableDevice(env, owner);
    const started = await startSession(env.db, context.actor, { deviceId: device.id });
    await expect(startSession(env.db, context.actor, { deviceId: device.id })).rejects.toThrow(ConflictError);
    await expect(resumeSession(env.db, context.actor, started.id)).rejects.toThrow(ConflictError);
    await endSession(env.db, context.actor, started.id);
    await expect(endSession(env.db, context.actor, started.id)).rejects.toThrow(ConflictError);
    await expect(pauseSession(env.db, context.actor, started.id)).rejects.toThrow(ConflictError);
  });

  it("rejects start on maintenance, disabled, and archived devices", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-device",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const context = seeded.context;
    const maintenance = await createDevice(env.db, context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC08",
      name: "PC 08",
      operationalStatus: "MAINTENANCE",
    });
    await createPricingAssignment(env.db, context.actor, {
      pricingPlanId: seeded.plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: maintenance.id,
    });
    await expect(startSession(env.db, context.actor, { deviceId: maintenance.id })).rejects.toThrow(ConflictError);

    await updateDevice(env.db, context.actor, seeded.device.id, { operationalStatus: "DISABLED" });
    await expect(startSession(env.db, context.actor, { deviceId: seeded.device.id })).rejects.toThrow(ConflictError);
    await updateDevice(env.db, context.actor, seeded.device.id, { operationalStatus: "ENABLED" });
    await archiveDevice(env.db, context.actor, seeded.device.id);
    await expect(startSession(env.db, context.actor, { deviceId: seeded.device.id })).rejects.toThrow(ConflictError);
  });

  it("links a same-tenant customer and rejects archived, blocked, and foreign customers", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-cust-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "sess-cust-b",
    });
    const seeded = await seedPlayableDevice(env, ownerA);
    const customer = await createCustomer(env.db, seeded.context.actor, { displayName: "Player One" });
    const started = await startSession(env.db, seeded.context.actor, {
      deviceId: seeded.device.id,
      customerId: customer.customer.id,
    });
    expect(started.customerId).toBe(customer.customer.id);

    const guestDevice = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC09",
      name: "PC 09",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: seeded.plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: guestDevice.id,
    });
    const guest = await startSession(env.db, seeded.context.actor, { deviceId: guestDevice.id });
    const assigned = await assignSessionCustomer(env.db, seeded.context.actor, guest.id, {
      customerId: customer.customer.id,
    });
    expect(assigned.customerId).toBe(customer.customer.id);
    await expect(
      assignSessionCustomer(env.db, seeded.context.actor, guest.id, { customerId: customer.customer.id }),
    ).rejects.toThrow(ConflictError);

    const archived = await createCustomer(env.db, seeded.context.actor, { displayName: "Old" });
    await archiveCustomer(env.db, seeded.context.actor, archived.customer.id);
    const device3 = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC10",
      name: "PC 10",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: seeded.plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: device3.id,
    });
    await expect(
      startSession(env.db, seeded.context.actor, {
        deviceId: device3.id,
        customerId: archived.customer.id,
      }),
    ).rejects.toThrow(ConflictError);

    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);
    const foreign = await createCustomer(env.db, contextB.actor, { displayName: "Other org" });
    await expect(
      startSession(env.db, seeded.context.actor, {
        deviceId: device3.id,
        customerId: foreign.customer.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("honors gaming.allow_guest_sessions", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-guest",
    });
    const { context, device } = await seedPlayableDevice(env, owner);
    await setOrganizationSetting(env.db, context.actor, "gaming.allow_guest_sessions", { value: false });
    await expect(startSession(env.db, context.actor, { deviceId: device.id })).rejects.toThrow(ConflictError);
    const customer = await createCustomer(env.db, context.actor, { displayName: "Named" });
    await expect(
      startSession(env.db, context.actor, { deviceId: device.id, customerId: customer.customer.id }),
    ).resolves.toMatchObject({ customerId: customer.customer.id });
  });

  it("moves a session, cancels with a reason, and keeps branch VIEW from operating", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-move",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const context = seeded.context;
    const other = await createDevice(env.db, context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC11",
      name: "PC 11",
    });
    await createPricingAssignment(env.db, context.actor, {
      pricingPlanId: seeded.plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: other.id,
    });
    const started = await startSession(env.db, context.actor, { deviceId: seeded.device.id });
    const moved = await moveSession(env.db, context.actor, started.id, { deviceId: other.id });
    expect(moved.currentDeviceId).toBe(other.id);
    const detail = await getSession(env.db, context.actor, started.id);
    expect(detail.segments).toHaveLength(2);
    expect(detail.segments[0]?.endReason).toBe("MOVE");

    const viewer = await createStaffMember(env, owner, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "FLOOR_VIEW",
      permissions: [PERMISSIONS.gamingSessionsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const viewContext = await resolveActor(env, viewer.headers, owner.organizationId);
    const listed = await listSessions(env.db, viewContext.actor, { branchId: seeded.branch.id });
    expect(listed.map((row) => row.id)).toContain(started.id);
    await expect(endSession(env.db, viewContext.actor, started.id)).rejects.toThrow(AuthorizationError);

    const viewOperator = await createStaffMember(env, owner, {
      email: "viewop@a.com",
      displayName: "View operator",
      roleCode: "VIEW_OP",
      permissions: [
        PERMISSIONS.gamingSessionsRead,
        PERMISSIONS.gamingSessionsStart,
        PERMISSIONS.gamingSessionsOperate,
      ],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const viewOpContext = await resolveActor(env, viewOperator.headers, owner.organizationId);
    await expect(endSession(env.db, viewOpContext.actor, started.id)).rejects.toThrow(AuthorizationError);

    const cancelled = await cancelSession(env.db, context.actor, started.id, { reason: "power cut" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("power cut");
  });

  it("requires session permissions and branch grants", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-authz",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const otherBranch = await createBranch(env.db, seeded.context.actor, { code: "MZH", name: "Mezzeh" });
      const none = await createStaffMember(env, owner, {
        email: "none@a.com",
        displayName: "None",
        roleCode: "NONE",
        permissions: [PERMISSIONS.branchesRead],
        branches: [{ branchId: seeded.branch.id, accessMode: "MANAGE" }],
      });
      const noneContext = await resolveActor(env, none.headers, owner.organizationId);
      await expect(listFloor(env.db, noneContext.actor, { branchId: seeded.branch.id })).rejects.toThrow(
        AuthorizationError,
      );

      const operator = await createStaffMember(env, owner, {
        email: "op@a.com",
        displayName: "Operator",
        roleCode: "OPERATOR",
        permissions: SESSION_PERMS.filter((code) => code !== PERMISSIONS.gamingSessionsCancel),
        branches: [{ branchId: seeded.branch.id, accessMode: "OPERATE" }],
      });
      const opContext = await resolveActor(env, operator.headers, owner.organizationId);
      const started = await startSession(env.db, opContext.actor, { deviceId: seeded.device.id });
      await expect(cancelSession(env.db, opContext.actor, started.id, { reason: "no" })).rejects.toThrow(
        AuthorizationError,
      );
      await expect(listFloor(env.db, opContext.actor, { branchId: otherBranch.id })).rejects.toThrow(
        AuthorizationError,
      );
      await endSession(env.db, opContext.actor, started.id);
  });

  it("hides other-tenant sessions and rejects unknown ids", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "sess-iso-b",
    });
    const seededA = await seedPlayableDevice(env, ownerA, { branchCode: "A1" });
    const seededB = await seedPlayableDevice(env, ownerB, { branchCode: "B1" });
    const sessionB = await startSession(env.db, seededB.context.actor, { deviceId: seededB.device.id });
    await expect(getSession(env.db, seededA.context.actor, sessionB.id)).rejects.toThrow(NotFoundError);
    await expect(endSession(env.db, seededA.context.actor, sessionB.id)).rejects.toThrow(NotFoundError);
    await expect(startSession(env.db, seededA.context.actor, { deviceId: seededB.device.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(getSession(env.db, seededA.context.actor, createId())).rejects.toThrow(NotFoundError);

    const rows = await withTenant(env.db, ownerA.organizationId, (tx) => tx.select().from(gamingSessions));
    expect(rows.map((row) => row.id)).not.toContain(sessionB.id);
  });

  it("projects available, occupied, maintenance, and disabled floor tiles", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-floor",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const context = seeded.context;
    await createPricingAssignment(env.db, context.actor, {
      pricingPlanId: seeded.plan.id,
      scopeType: "AREA",
      branchId: seeded.branch.id,
      scopeId: seeded.area.id,
    });
    const maintenance = await createDevice(env.db, context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC-M",
      name: "Maint",
      operationalStatus: "MAINTENANCE",
    });
    const disabled = await createDevice(env.db, context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC-D",
      name: "Down",
      operationalStatus: "DISABLED",
    });
    const started = await startSession(env.db, context.actor, { deviceId: seeded.device.id });
    const floor = await listFloor(env.db, context.actor, { branchId: seeded.branch.id });
    const byCode = Object.fromEntries(floor.map((tile) => [tile.code, tile]));
    expect(byCode[seeded.device.code]?.occupancy).toBe("OCCUPIED");
    expect(byCode[seeded.device.code]?.session?.session.id).toBe(started.id);
    expect(byCode[maintenance.code]?.occupancy).toBe("UNAVAILABLE");
    expect(byCode[maintenance.code]?.session).toBeNull();
    expect(byCode[disabled.code]?.occupancy).toBe("UNAVAILABLE");

    const viewer = await createStaffMember(env, owner, {
      email: "floorview@a.com",
      displayName: "Floor view",
      roleCode: "FLOOR_ONLY",
      permissions: [PERMISSIONS.gamingSessionsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const viewContext = await resolveActor(env, viewer.headers, owner.organizationId);
    const sessionBranches = await listSessionBranches(env.db, viewContext.actor, "VIEW");
    expect(sessionBranches.map((row) => row.id)).toContain(seeded.branch.id);
    await expect(listAccessibleBranches(env.db, viewContext.actor, "VIEW")).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("refuses PACKAGE + MOVE so package price cannot be charged per segment", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "sess-pkg-move",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const pack = await createPricingPlan(env.db, seeded.context.actor, {
      code: "HOUR",
      name: "Hour pack",
      pricingModel: "PACKAGE",
      roundingMode: "CEIL",
      packageDurationSeconds: 3600,
      packagePriceMinor: 5000,
    });
    const packDevice = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC-PKG",
      name: "Package PC",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: pack.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: packDevice.id,
    });
    const timeDevice = await createDevice(env.db, seeded.context.actor, {
      branchId: seeded.branch.id,
      areaId: seeded.area.id,
      deviceTypeId: seeded.deviceType.id,
      code: "PC-T",
      name: "Timed PC",
    });
    await createPricingAssignment(env.db, seeded.context.actor, {
      pricingPlanId: seeded.plan.id,
      scopeType: "DEVICE",
      branchId: seeded.branch.id,
      scopeId: timeDevice.id,
    });
    const started = await startSession(env.db, seeded.context.actor, { deviceId: packDevice.id });
    await expect(
      moveSession(env.db, seeded.context.actor, started.id, { deviceId: timeDevice.id }),
    ).rejects.toThrow(/PACKAGE \+ MOVE is not supported/i);
  });
});
