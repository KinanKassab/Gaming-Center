import { describe, expect, it } from "vitest";
import { ConflictError } from "@/core/errors";
import { coreUsers } from "@/db/schema";
import {
  claimHttpSignupSlot,
  createOrganization,
  releaseHttpSignupClaim,
  runWithPlatformOrganizationClaim,
} from "@/modules/identity";
import { createTestEnvironment, seedOwnerWithOrganization, signUp } from "../helpers/identity";

describe("platform bootstrap claims", () => {
  it("HTTP signup slot can be claimed once and released on failure", async () => {
    const env = await createTestEnvironment();
    expect(await claimHttpSignupSlot(env.db)).toBe(true);
    expect(await claimHttpSignupSlot(env.db)).toBe(false);
    await releaseHttpSignupClaim(env.db);
    expect(await claimHttpSignupSlot(env.db)).toBe(true);
  });

  it("HTTP signup slot is closed once any core user exists", async () => {
    const env = await createTestEnvironment();
    await signUp(env.auth, { email: "owner@example.com", password: "password-123", name: "Owner" });
    expect(await claimHttpSignupSlot(env.db)).toBe(false);
    const users = await env.db.select({ id: coreUsers.id }).from(coreUsers);
    expect(users).toHaveLength(1);
  });

  it("HTTP organization claim rejects a second initial organization; domain can still add tenants", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });

    await expect(
      runWithPlatformOrganizationClaim(() =>
        createOrganization(
          env.db,
          { userId: owner.userId },
          {
            slug: "org-http-second",
            name: "HTTP Second",
            defaultCurrency: "SYP",
            timezone: "Asia/Damascus",
            locale: "ar",
          },
        ),
      ),
    ).rejects.toThrow(ConflictError);

    const second = await createOrganization(
      env.db,
      { userId: owner.userId },
      {
        slug: "org-b",
        name: "Org B",
        defaultCurrency: "SYP",
        timezone: "Asia/Damascus",
        locale: "ar",
      },
    );
    expect(second.organizationId).not.toBe(owner.organizationId);
  });
});
