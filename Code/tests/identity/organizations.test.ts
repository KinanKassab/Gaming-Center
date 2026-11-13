import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError } from "@/core/errors";
import { authenticateRequest } from "@/auth/context";
import {
  ADD_MEMBER_REJECTED_MESSAGE,
  PERMISSIONS,
  activateInvitedMembership,
  attachUserByEmail,
  createOrganization,
  createUserWithMembership,
  getOrganizationProfile,
  listUserMemberships,
  setMembershipStatus,
  updateOrganizationProfile,
} from "@/modules/identity";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import {
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
  signUp,
} from "../helpers/identity";

describe("organization membership enforcement", () => {
  it("rejects a user without any membership, even for a valid organization id", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });

    await signUp(env.auth, { email: "stranger@x.com", password: "password-123", name: "Stranger" });
    const strangerHeaders = await signInHeaders(env.auth, {
      email: "stranger@x.com",
      password: "password-123",
    });

    await expect(resolveActor(env, strangerHeaders, owner.organizationId)).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("resolves tenant context for a valid ACTIVE membership with owner permissions", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });

    const context = await resolveActor(env, owner.headers, owner.organizationId);

    expect(context.organization.slug).toBe("org-a");
    expect(context.actor.organizationId).toBe(owner.organizationId);
    expect(context.actor.membershipId).toBe(owner.membershipId);
    expect(context.actor.permissions).toEqual(
      expect.arrayContaining([
        PERMISSIONS.organizationsManage,
        PERMISSIONS.membershipsManage,
        PERMISSIONS.rolesManage,
        PERMISSIONS.branchesManage,
        PERMISSIONS.auditRead,
      ]),
    );
  });

  it("organization A member cannot resolve organization B, even knowing its UUID", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "org-b",
    });

    await expect(resolveActor(env, ownerA.headers, ownerB.organizationId)).rejects.toThrow(
      AuthorizationError,
    );
    await expect(resolveActor(env, ownerB.headers, ownerA.organizationId)).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("a user only sees their own memberships and organizations", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "org-b",
    });

    const memberships = await listUserMemberships(env.db, ownerA.userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.organizationSlug).toBe("org-a");
  });

  it("suspended membership loses tenant access immediately", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    const created = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "cashier@a.com", password: "password-123", displayName: "Cashier" },
      createAuthAccountProvisioner(env.auth),
    );
    const cashierHeaders = await signInHeaders(env.auth, {
      email: "cashier@a.com",
      password: "password-123",
    });

    // Works while ACTIVE.
    const cashierContext = await resolveActor(env, cashierHeaders, owner.organizationId);
    expect(cashierContext.actor.membershipId).toBe(created.membershipId);

    await setMembershipStatus(env.db, ownerContext.actor, created.membershipId, "suspend");
    await expect(resolveActor(env, cashierHeaders, owner.organizationId)).rejects.toThrow(
      "Membership is suspended",
    );

    await setMembershipStatus(env.db, ownerContext.actor, created.membershipId, "reactivate");
    const restored = await resolveActor(env, cashierHeaders, owner.organizationId);
    expect(restored.actor.membershipId).toBe(created.membershipId);
  });

  it("INVITED membership grants no access until the user activates it themselves", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    await signUp(env.auth, { email: "invitee@x.com", password: "password-123", name: "Invitee" });
    const inviteeHeaders = await signInHeaders(env.auth, {
      email: "invitee@x.com",
      password: "password-123",
    });
    const inviteeAuth = await authenticateRequest(env.db, env.auth, inviteeHeaders);

    const attached = await attachUserByEmail(env.db, ownerContext.actor, {
      email: "invitee@x.com",
    });

    await expect(resolveActor(env, inviteeHeaders, owner.organizationId)).rejects.toThrow(
      "Invitation has not been accepted yet",
    );

    const activated = await activateInvitedMembership(
      env.db,
      inviteeAuth.user.id,
      owner.organizationId,
    );
    expect(activated.membershipId).toBe(attached.membershipId);

    const context = await resolveActor(env, inviteeHeaders, owner.organizationId);
    expect(context.actor.membershipId).toBe(attached.membershipId);
    // Attached without roles: authenticated, member, but zero permissions.
    expect(context.actor.permissions).toEqual([]);
  });

  it("rejects duplicate memberships for the same user and organization", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    await signUp(env.auth, { email: "member@x.com", password: "password-123", name: "Member" });
    await attachUserByEmail(env.db, ownerContext.actor, { email: "member@x.com" });
    await expect(
      attachUserByEmail(env.db, ownerContext.actor, { email: "member@x.com" }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects duplicate organization slugs", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    await expect(
      createOrganization(env.db, { userId: owner.userId }, {
        slug: "org-a",
        name: "Duplicate",
        defaultCurrency: "SYP",
        timezone: "Asia/Damascus",
        locale: "ar",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("organization profile updates require the manage permission", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    const created = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "plain@a.com", password: "password-123", displayName: "Plain" },
      createAuthAccountProvisioner(env.auth),
    );
    expect(created.membershipId).toBeTruthy();
    const plainHeaders = await signInHeaders(env.auth, {
      email: "plain@a.com",
      password: "password-123",
    });
    const plainContext = await resolveActor(env, plainHeaders, owner.organizationId);

    await expect(
      updateOrganizationProfile(env.db, plainContext.actor, { name: "Hacked" }),
    ).rejects.toThrow(AuthorizationError);

    const updated = await updateOrganizationProfile(env.db, ownerContext.actor, {
      name: "Renamed Gaming Center",
    });
    expect(updated.name).toBe("Renamed Gaming Center");
  });

  it("create after an orphaned login converges by attaching the existing identity", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    await signUp(env.auth, {
      email: "orphan@a.com",
      password: "password-123",
      name: "Orphan",
    });

    const result = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "orphan@a.com", password: "password-123", displayName: "Orphan" },
      createAuthAccountProvisioner(env.auth),
    );

    const headers = await signInHeaders(env.auth, {
      email: "orphan@a.com",
      password: "password-123",
    });
    const context = await resolveActor(env, headers, owner.organizationId);
    expect(context.actor.membershipId).toBe(result.membershipId);
    expect(context.actor.userId).toBe(result.userId);
  });

  it("add-member errors do not distinguish unknown, existing, or already-member accounts", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-a",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const provision = createAuthAccountProvisioner(env.auth);

    const unknown = await attachUserByEmail(env.db, ownerContext.actor, {
      email: "nobody@x.com",
    }).catch((error: unknown) => error);

    await signUp(env.auth, { email: "member@x.com", password: "password-123", name: "Member" });
    await attachUserByEmail(env.db, ownerContext.actor, { email: "member@x.com" });
    const already = await attachUserByEmail(env.db, ownerContext.actor, {
      email: "member@x.com",
    }).catch((error: unknown) => error);

    const duplicateCreate = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "member@x.com", password: "password-123", displayName: "Member" },
      provision,
    ).catch((error: unknown) => error);

    expect(unknown).toBeInstanceOf(ConflictError);
    expect(already).toBeInstanceOf(ConflictError);
    expect(duplicateCreate).toBeInstanceOf(ConflictError);
    expect((unknown as ConflictError).message).toBe(ADD_MEMBER_REJECTED_MESSAGE);
    expect((already as ConflictError).message).toBe((unknown as ConflictError).message);
    expect((duplicateCreate as ConflictError).message).toBe((unknown as ConflictError).message);
  });

  it("defaults timezone to Asia/Damascus and accepts first-organization language ar/en", async () => {
    const env = await createTestEnvironment();
    await signUp(env.auth, { email: "owner@tz.com", password: "password-123", name: "Owner" });
    const headers = await signInHeaders(env.auth, { email: "owner@tz.com", password: "password-123" });
    const authContext = await authenticateRequest(env.db, env.auth, headers);
    const created = await createOrganization(env.db, { userId: authContext.user.id }, {
      slug: "tz-center",
      name: "Timezone Center",
      defaultCurrency: "SYP",
      locale: "ar",
    });
    const actor = await resolveActor(env, headers, created.organizationId);
    const profile = await getOrganizationProfile(env.db, actor.actor);
    expect(profile.timezone).toBe("Asia/Damascus");
    expect(profile.locale).toBe("ar");
  });
});
