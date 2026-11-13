import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { listAuditLogs, PERMISSIONS } from "@/modules/identity";
import {
  archiveDeviceType,
  archiveWizardDeviceType,
  createDeviceType,
  DEVICE_TYPE_IN_USE_REASON,
  getDeviceType,
  listDeviceTypes,
  listDevices,
  startSession,
  updateDeviceType,
} from "@/modules/gaming";
import { createStaffMember, createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

describe("gaming device types", () => {
  it("creates, lists, updates, and archives a device type", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "type-crud",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const created = await createDeviceType(env.db, context.actor, {
      code: "pc",
      name: " PC station ",
      category: " PC ",
    });
    expect(created.code).toBe("PC");
    expect(created.name).toBe("PC station");
    expect(created.category).toBe("PC");
    const autoCoded = await createDeviceType(env.db, context.actor, { name: "PlayStation 5" });
    expect(autoCoded.code.startsWith("T-")).toBe(true);
    const listed = await listDeviceTypes(env.db, context.actor, { q: "PC" });
    expect(listed.map((row) => row.id)).toContain(created.id);
    const updated = await updateDeviceType(env.db, context.actor, created.id, { name: "Desktop", category: null });
    expect(updated.name).toBe("Desktop");
    expect(updated.category).toBeNull();
    const archived = await archiveDeviceType(env.db, context.actor, created.id);
    expect(archived.status).toBe("ARCHIVED");
    await expect(updateDeviceType(env.db, context.actor, created.id, { name: "Nope" })).rejects.toThrow(ConflictError);
  });

  it("rejects invalid input, missing permission, and cross-tenant ids", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "type-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "type-iso-b",
    });
    const contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);
    await expect(createDeviceType(env.db, contextA.actor, { code: "***", name: "Bad" })).rejects.toThrow(
      ValidationError,
    );
    const typeB = await createDeviceType(env.db, contextB.actor, { code: "PS5", name: "PlayStation" });
    await expect(getDeviceType(env.db, contextA.actor, typeB.id)).rejects.toThrow(NotFoundError);

    const staff = await createStaffMember(env, ownerA, {
      email: "reader@a.com",
      displayName: "Reader",
      roleCode: "TYPE_READ",
      permissions: [PERMISSIONS.gamingMasterRead],
    });
    const staffContext = await resolveActor(env, staff.headers, ownerA.organizationId);
    await expect(createDeviceType(env.db, staffContext.actor, { code: "PC", name: "PC" })).rejects.toThrow(
      AuthorizationError,
    );
    const listed = await listDeviceTypes(env.db, staffContext.actor);
    expect(listed).toEqual([]);
  });

  it("audits device type mutations", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "type-audit",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const created = await createDeviceType(env.db, context.actor, { code: "PC", name: "PC" });
    await updateDeviceType(env.db, context.actor, created.id, { name: "Desktop" });
    await archiveDeviceType(env.db, context.actor, created.id);
    const logs = await listAuditLogs(env.db, context.actor, { limit: 50 });
    expect(logs.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "gaming.device_type.created",
        "gaming.device_type.updated",
        "gaming.device_type.archived",
      ]),
    );
  });

  it("wizard archive soft-deletes the type and its free stations together", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "type-wizard-archive",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const archived = await archiveWizardDeviceType(env.db, seeded.context.actor, seeded.deviceType.id);
    expect(archived.status).toBe("ARCHIVED");
    const types = await listDeviceTypes(env.db, seeded.context.actor);
    expect(types.map((row) => row.id)).not.toContain(seeded.deviceType.id);
    const devices = await listDevices(env.db, seeded.context.actor);
    expect(devices.map((row) => row.id)).not.toContain(seeded.device.id);
  });

  it("refuses wizard archive when a station of that type is in play", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "type-wizard-in-use",
    });
    const seeded = await seedPlayableDevice(env, owner);
    await startSession(env.db, seeded.context.actor, { deviceId: seeded.device.id });
    await expect(
      archiveWizardDeviceType(env.db, seeded.context.actor, seeded.deviceType.id),
    ).rejects.toMatchObject({ reason: DEVICE_TYPE_IN_USE_REASON });
  });
});
