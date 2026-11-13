import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/core/errors";
import { authenticateRequest, loadSessionCoreUser } from "@/auth/context";
import { publicEntryHref } from "@/auth/entry";
import { coreUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  PERMISSIONS,
  PURGED_STAFF_DISPLAY_NAME,
  applyDueStaffPurge,
  setMembershipStatus,
} from "@/modules/identity";
import { createStaffMember, createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

describe("staff access revoke", () => {
  it("disables the login, blocks admin auth, then anonymizes after 30 days", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "staff-rev",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const staff = await createStaffMember(env, owner, {
      email: "cashier@a.com",
      displayName: "Cashier",
      roleCode: "CASHIER",
      permissions: [PERMISSIONS.gamingSessionsRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "OPERATE" }],
    });
    const ownerActor = (await resolveActor(env, owner.headers, owner.organizationId)).actor;

    await setMembershipStatus(env.db, ownerActor, staff.membershipId, "revoke");

    await expect(authenticateRequest(env.db, env.auth, staff.headers)).rejects.toThrow(AuthorizationError);
    const sessionUser = await loadSessionCoreUser(env.db, env.auth, staff.headers);
    expect(sessionUser?.status).toBe("DISABLED");
    expect(sessionUser?.email).toBe("cashier@a.com");
    expect(publicEntryHref(sessionUser)).toBe("/access-revoked");

    await expect(setMembershipStatus(env.db, ownerActor, owner.membershipId, "revoke")).rejects.toThrow(
      /your own membership/i,
    );

    const due = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const purged = await applyDueStaffPurge(env.db, sessionUser!, due);
    expect(purged.email).toBeNull();
    expect(purged.displayName).toBe(PURGED_STAFF_DISPLAY_NAME);

    const stored = await env.db.select().from(coreUsers).where(eq(coreUsers.id, staff.userId)).limit(1);
    expect(stored[0]?.email).toBeNull();
    expect(stored[0]?.status).toBe("DISABLED");
  });
});
