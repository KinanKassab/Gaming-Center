import { describe, expect, it } from "vitest";
import { ConflictError } from "@/core/errors";
import {
  BRANCH_NAME_IN_USE_REASON,
  archiveBranch,
  createBranch,
  listBranches,
  updateBranch,
} from "@/modules/identity";
import { createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";

async function ownerActor(
  env: Awaited<ReturnType<typeof createTestEnvironment>>,
  email: string,
  slug: string,
) {
  const owner = await seedOwnerWithOrganization(env, {
    email,
    name: "Owner",
    slug,
  });
  const context = await resolveActor(env, owner.headers, owner.organizationId);
  return { owner, actor: context.actor };
}

describe("BUG-035 branch visible-name uniqueness", () => {
  it("rejects an exact duplicate name in the same organization", async () => {
    const env = await createTestEnvironment();
    const { actor } = await ownerActor(env, "owner@a.com", "org-a");
    const first = await createBranch(env.db, actor, { name: "Jaramana" });
    await expect(createBranch(env.db, actor, { name: "Jaramana" })).rejects.toMatchObject({
      name: "ConflictError",
      reason: BRANCH_NAME_IN_USE_REASON,
    });
    const listed = await listBranches(env.db, actor);
    expect(listed.filter((row) => row.name === "Jaramana")).toHaveLength(1);
    expect(listed.find((row) => row.id === first.id)?.code).toBe(first.code);
  });

  it("rejects whitespace-only differences after trim", async () => {
    const env = await createTestEnvironment();
    const { actor } = await ownerActor(env, "owner@a.com", "org-trim");
    const first = await createBranch(env.db, actor, { name: "Jaramana" });
    await expect(createBranch(env.db, actor, { name: " Jaramana " })).rejects.toBeInstanceOf(ConflictError);
    await expect(createBranch(env.db, actor, { name: "Jaramana   " })).rejects.toMatchObject({
      reason: BRANCH_NAME_IN_USE_REASON,
    });
    expect(first.name).toBe("Jaramana");
  });

  it("rejects Latin case-equivalent names in the same organization", async () => {
    const env = await createTestEnvironment();
    const { actor } = await ownerActor(env, "owner@a.com", "org-case");
    await createBranch(env.db, actor, { name: "Jaramana" });
    await expect(createBranch(env.db, actor, { name: "jaramana" })).rejects.toMatchObject({
      reason: BRANCH_NAME_IN_USE_REASON,
    });
  });

  it("allows the same visible name in a different organization", async () => {
    const env = await createTestEnvironment();
    const a = await ownerActor(env, "owner@a.com", "org-a-main");
    const b = await ownerActor(env, "owner@b.com", "org-b-main");
    const branchA = await createBranch(env.db, a.actor, { name: "Main" });
    const branchB = await createBranch(env.db, b.actor, { name: "Main" });
    expect(branchA.name).toBe("Main");
    expect(branchB.name).toBe("Main");
    expect(branchA.organizationId).not.toBe(branchB.organizationId);
  });

  it("rejects renaming onto another branch name and leaves both records unchanged", async () => {
    const env = await createTestEnvironment();
    const { actor } = await ownerActor(env, "owner@a.com", "org-rename");
    const alpha = await createBranch(env.db, actor, { name: "Alpha" });
    const beta = await createBranch(env.db, actor, { name: "Beta" });
    await expect(updateBranch(env.db, actor, beta.id, { name: "Alpha" })).rejects.toMatchObject({
      reason: BRANCH_NAME_IN_USE_REASON,
    });
    const listed = await listBranches(env.db, actor);
    expect(listed.find((row) => row.id === alpha.id)?.name).toBe("Alpha");
    expect(listed.find((row) => row.id === beta.id)?.name).toBe("Beta");
  });

  it("allows a unique rename and a same-row Latin case change", async () => {
    const env = await createTestEnvironment();
    const { actor } = await ownerActor(env, "owner@a.com", "org-ok-rename");
    const alpha = await createBranch(env.db, actor, { name: "Alpha" });
    await createBranch(env.db, actor, { name: "Beta" });
    const renamed = await updateBranch(env.db, actor, alpha.id, { name: "Gamma" });
    expect(renamed.id).toBe(alpha.id);
    expect(renamed.name).toBe("Gamma");
    const cased = await updateBranch(env.db, actor, alpha.id, { name: "gamma" });
    expect(cased.id).toBe(alpha.id);
    expect(cased.name).toBe("gamma");
  });

  it("keeps archived names reserved so reuse cannot create an ambiguous selector", async () => {
    const env = await createTestEnvironment();
    const { actor } = await ownerActor(env, "owner@a.com", "org-archive");
    const archived = await archiveBranch(
      env.db,
      actor,
      (await createBranch(env.db, actor, { name: "Legacy" })).id,
    );
    expect(archived.status).toBe("ARCHIVED");
    await expect(createBranch(env.db, actor, { name: "Legacy" })).rejects.toMatchObject({
      reason: BRANCH_NAME_IN_USE_REASON,
    });
  });

  it("still rejects duplicate internal codes independently of names", async () => {
    const env = await createTestEnvironment();
    const { actor } = await ownerActor(env, "owner@a.com", "org-code");
    await createBranch(env.db, actor, { code: "JRM", name: "Jaramana" });
    await expect(createBranch(env.db, actor, { code: "JRM", name: "Mezzeh" })).rejects.toThrow(
      /Branch code is already in use/,
    );
  });

  it("cannot create two same-name branches through a concurrent race", async () => {
    const env = await createTestEnvironment();
    const { actor } = await ownerActor(env, "owner@a.com", "org-race");
    const settled = await Promise.allSettled([
      createBranch(env.db, actor, { name: "Race Branch" }),
      createBranch(env.db, actor, { name: "Race Branch" }),
    ]);
    const fulfilled = settled.filter((row) => row.status === "fulfilled");
    const rejected = settled.filter((row) => row.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const failure = rejected[0];
    expect(failure?.status).toBe("rejected");
    if (failure?.status === "rejected") {
      expect(failure.reason).toBeInstanceOf(ConflictError);
      expect((failure.reason as ConflictError).reason).toBe(BRANCH_NAME_IN_USE_REASON);
    }
    const listed = await listBranches(env.db, actor);
    expect(listed.filter((row) => row.name === "Race Branch")).toHaveLength(1);
  });
});
