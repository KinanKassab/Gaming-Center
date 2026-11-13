import { describe, expect, it } from "vitest";
import { createBranch } from "@/modules/identity";
import {
  listBranchIdsWithFloorDevices,
  listFloor,
  listSessionBranches,
  resolveFloorBranchId,
} from "@/modules/gaming";
import { createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

describe("BUG-036 Floor default branch (operational data)", () => {
  it("selects the branch that has devices instead of the first empty code-sorted branch", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "floor-def",
    });
    const seeded = await seedPlayableDevice(env, owner, { branchCode: "ZZZ", deviceCode: "Z1" });
    await createBranch(env.db, seeded.context.actor, { code: "AAA", name: "Empty first" });
    const actor = (await resolveActor(env, owner.headers, owner.organizationId)).actor;
    const branches = (await listSessionBranches(env.db, actor, "VIEW")).filter(
      (branch) => branch.status !== "ARCHIVED",
    );
    expect(branches[0]?.code).toBe("AAA");
    expect(branches.some((branch) => branch.id === seeded.branch.id)).toBe(true);

    const withDevices = await listBranchIdsWithFloorDevices(
      env.db,
      actor,
      branches.map((branch) => branch.id),
    );
    expect(withDevices).toEqual([seeded.branch.id]);

    const resolved = resolveFloorBranchId({
      requestedBranchId: undefined,
      accessibleBranchIds: branches.map((branch) => branch.id),
      branchIdsWithDevices: withDevices,
    });
    expect(resolved).toBe(seeded.branch.id);

    const floor = await listFloor(env.db, actor, { branchId: resolved! });
    expect(floor.some((tile) => tile.deviceId === seeded.device.id)).toBe(true);
  });

  it("keeps an explicit empty branch when the operator selected it", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "floor-exp",
    });
    const seeded = await seedPlayableDevice(env, owner, { branchCode: "MAIN", deviceCode: "M1" });
    const empty = await createBranch(env.db, seeded.context.actor, { code: "NEW", name: "New empty" });
    const actor = (await resolveActor(env, owner.headers, owner.organizationId)).actor;
    const branches = (await listSessionBranches(env.db, actor, "VIEW")).filter(
      (branch) => branch.status !== "ARCHIVED",
    );
    const withDevices = await listBranchIdsWithFloorDevices(
      env.db,
      actor,
      branches.map((branch) => branch.id),
    );
    expect(
      resolveFloorBranchId({
        requestedBranchId: empty.id,
        accessibleBranchIds: branches.map((branch) => branch.id),
        branchIdsWithDevices: withDevices,
      }),
    ).toBe(empty.id);
    const floor = await listFloor(env.db, actor, { branchId: empty.id });
    expect(floor).toHaveLength(0);
  });
});
