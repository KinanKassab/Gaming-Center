import { describe, expect, it } from "vitest";
import { AuthorizationError, NotFoundError, ValidationError } from "@/core/errors";
import { createBranch, listAuditLogs, PERMISSIONS } from "@/modules/identity";
import {
  clearBranchSetting,
  listFeatures,
  listSettings,
  setBranchSetting,
  setOrganizationFeature,
  setOrganizationSetting,
} from "@/modules/settings";
import {
  createStaffMember,
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";

describe("settings and features", () => {
  it("returns definition defaults when no values are stored", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "set-default",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const settings = await listSettings(env.db, context.actor);
    const billing = settings.find((row) => row.key === "gaming.billing_unit_seconds");
    const guests = settings.find((row) => row.key === "gaming.allow_guest_sessions");
    expect(billing?.effectiveValue).toBe(60);
    expect(billing?.source).toBe("DEFAULT");
    expect(guests?.effectiveValue).toBe(true);
    expect(guests?.source).toBe("DEFAULT");
  });

  it("stores an organization value and uses it as the effective value", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "set-org",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    await setOrganizationSetting(env.db, context.actor, "gaming.billing_unit_seconds", { value: 120 });
    const settings = await listSettings(env.db, context.actor);
    const billing = settings.find((row) => row.key === "gaming.billing_unit_seconds");
    expect(billing?.organizationValue).toBe(120);
    expect(billing?.effectiveValue).toBe(120);
    expect(billing?.source).toBe("ORGANIZATION");
  });

  it("applies a branch override only for that branch after assertBranchAccess", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "set-branch",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const jaramana = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });
    const mezzeh = await createBranch(env.db, ownerContext.actor, { code: "MZH", name: "Mezzeh" });
    const actor = (await resolveActor(env, owner.headers, owner.organizationId)).actor;
    await setOrganizationSetting(env.db, actor, "gaming.billing_unit_seconds", {
      value: 120,
    });
    await setBranchSetting(env.db, actor, "gaming.billing_unit_seconds", jaramana.id, {
      value: 30,
    });

    const atJaramana = await listSettings(env.db, actor, { branchId: jaramana.id });
    const atMezzeh = await listSettings(env.db, actor, { branchId: mezzeh.id });
    expect(atJaramana.find((row) => row.key === "gaming.billing_unit_seconds")?.effectiveValue).toBe(30);
    expect(atJaramana.find((row) => row.key === "gaming.billing_unit_seconds")?.source).toBe("BRANCH");
    expect(atMezzeh.find((row) => row.key === "gaming.billing_unit_seconds")?.effectiveValue).toBe(120);
    expect(atMezzeh.find((row) => row.key === "gaming.billing_unit_seconds")?.source).toBe(
      "ORGANIZATION",
    );
  });

  it("rejects invalid types and unknown keys", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "set-invalid",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    await expect(
      setOrganizationSetting(env.db, context.actor, "gaming.allow_guest_sessions", { value: "yes" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      setOrganizationSetting(env.db, context.actor, "gaming.billing_unit_seconds", { value: 0 }),
    ).rejects.toThrow(ValidationError);
    await expect(
      setOrganizationSetting(env.db, context.actor, "made.up.key", { value: true }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects unauthorized reads and writes", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "set-authz",
    });
    const reader = await createStaffMember(env, owner, {
      email: "reader@a.com",
      displayName: "Reader",
      roleCode: "SET_READ",
      permissions: [PERMISSIONS.settingsRead],
    });
    const none = await createStaffMember(env, owner, {
      email: "none@a.com",
      displayName: "None",
      roleCode: "NONE",
      permissions: [PERMISSIONS.customersRead],
    });
    const readerContext = await resolveActor(env, reader.headers, owner.organizationId);
    const noneContext = await resolveActor(env, none.headers, owner.organizationId);

    await expect(listSettings(env.db, noneContext.actor)).rejects.toThrow(AuthorizationError);
    const readable = await listSettings(env.db, readerContext.actor);
    expect(readable.length).toBeGreaterThan(0);
    await expect(
      setOrganizationSetting(env.db, readerContext.actor, "gaming.allow_guest_sessions", {
        value: false,
      }),
    ).rejects.toThrow(AuthorizationError);
  });

  it("rejects branch override without branch access", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "set-baccess",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });
    const staff = await createStaffMember(env, owner, {
      email: "staff@a.com",
      displayName: "Staff",
      roleCode: "SET_MGR",
      permissions: [PERMISSIONS.settingsRead, PERMISSIONS.settingsManage],
      branches: [],
    });
    const staffContext = await resolveActor(env, staff.headers, owner.organizationId);
    await expect(
      setBranchSetting(env.db, staffContext.actor, "gaming.billing_unit_seconds", branch.id, {
        value: 15,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(listSettings(env.db, staffContext.actor, { branchId: branch.id })).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("audits setting mutations and feature toggles", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "set-audit",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, context.actor, { code: "JRM", name: "Jaramana" });
    const actor = (await resolveActor(env, owner.headers, owner.organizationId)).actor;
    await setOrganizationSetting(env.db, actor, "gaming.allow_guest_sessions", { value: false });
    await setBranchSetting(env.db, actor, "gaming.allow_guest_sessions", branch.id, {
      value: true,
    });
    await clearBranchSetting(env.db, actor, "gaming.allow_guest_sessions", branch.id);
    await setOrganizationFeature(env.db, actor, "pos.sales", { enabled: false });
    const logs = await listAuditLogs(env.db, actor, { limit: 50 });
    const actions = logs.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "core.setting.updated",
        "core.setting.cleared",
        "core.feature.updated",
      ]),
    );
    const features = await listFeatures(env.db, context.actor);
    expect(features.find((row) => row.code === "pos.sales")?.enabled).toBe(false);
    expect(features.find((row) => row.code === "pos.sales")?.source).toBe("ORGANIZATION");
  });

  it("does not leak Organization B settings to Organization A", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "set-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "set-iso-b",
    });
    const contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);
    await setOrganizationSetting(env.db, contextB.actor, "gaming.billing_unit_seconds", { value: 9 });
    const settingsA = await listSettings(env.db, contextA.actor);
    expect(settingsA.find((row) => row.key === "gaming.billing_unit_seconds")?.effectiveValue).toBe(
      60,
    );
  });
});
