import { describe, expect, it } from "vitest";
import { createId } from "@/core/ids";
import { assertRuntimeDatabaseRole } from "@/db/client";
import { ConflictError } from "@/core/errors";
import { authenticateRequest } from "@/auth/context";
import {
  activateInvitedMembership,
  attachUserByEmail,
  createUserWithMembership,
  setMembershipStatus,
} from "@/modules/identity";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import {
  createTestEnvironment,
  requireGamingAppRole,
  resolveActor,
  seedOwnerWithOrganization,
  signInHeaders,
  signUp,
  type TestEnvironment,
} from "../helpers/identity";
import { createMigratedPglite } from "../helpers/pglite";

async function userIdFromHeaders(env: TestEnvironment, headers: Headers): Promise<string> {
  const context = await authenticateRequest(env.db, env.auth, headers);
  return context.user.id;
}

describe("RLS and identity security hardening", () => {
  it("fails closed when gaming_app is required and present", async () => {
    const { client } = await createMigratedPglite();
    await requireGamingAppRole(client);
  });

  it("gaming_app cannot disable tenant RLS through app.bypass_rls", async () => {
    const { client } = await createMigratedPglite();
    await requireGamingAppRole(client);

    const orgA = createId();
    const orgB = createId();
    const branchA = createId();
    const branchB = createId();
    await client.query(
      `INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
       VALUES ($1, 'sec-a', 'Sec A', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')`,
      [orgA],
    );
    await client.query(
      `INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
       VALUES ($1, 'sec-b', 'Sec B', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')`,
      [orgB],
    );
    await client.query(
      `INSERT INTO core_branches (id, organization_id, code, name, status)
       VALUES ($1, $2, 'A1', 'A', 'ACTIVE'), ($3, $4, 'B1', 'B', 'ACTIVE')`,
      [branchA, orgA, branchB, orgB],
    );
    await client.query(
      `INSERT INTO core_customers (id, organization_id, display_name, status, portal_token, created_branch_id)
       VALUES ($1, $2, 'Cust A', 'ACTIVE', gen_random_uuid(), $3),
              ($4, $5, 'Cust B', 'ACTIVE', gen_random_uuid(), $6)`,
      [createId(), orgA, branchA, createId(), orgB, branchB],
    );

    await client.query(`SET ROLE gaming_app`);
    await client.query(`SELECT set_config('app.bypass_rls', 'on', false)`);
    await client.query(`SELECT set_config('app.organization_id', $1, false)`, [orgA]);

    const visible = await client.query<{ display_name: string }>(
      `SELECT display_name FROM core_customers ORDER BY display_name`,
    );
    expect(visible.rows.map((row) => row.display_name)).toEqual(["Cust A"]);

    await client.query(`SELECT set_config('app.organization_id', '', false)`);
    const unscoped = await client.query<{ display_name: string }>(
      `SELECT display_name FROM core_customers`,
    );
    expect(unscoped.rows).toEqual([]);
  });

  it("application runtime connection is gaming_app, not superuser, and has no BYPASSRLS", async () => {
    const env = await createTestEnvironment();
    const attributes = await assertRuntimeDatabaseRole(env.db);
    expect(attributes.currentUser).toBe("gaming_app");
    expect(attributes.isSuperuser).toBe(false);
    expect(attributes.hasBypassRls).toBe(false);
  });

  it("rejects a privileged (superuser/owner) connection as the request runtime", async () => {
    const { client, db } = await createMigratedPglite();
    await requireGamingAppRole(client);
    await expect(assertRuntimeDatabaseRole(db)).rejects.toThrow(/Unsafe runtime database role/);
  });

  it("rejects duplicate auth issuer/account identities", async () => {
    const { client } = await createMigratedPglite();
    await client.query(
      `INSERT INTO auth_users (id, name, email) VALUES ('u-1', 'One', 'one@example.com')`,
    );
    await client.query(
      `INSERT INTO auth_accounts (id, issuer, account_id, provider_id, user_id)
       VALUES ('acc-1', 'local:credential', 'acct-dup', 'credential', 'u-1')`,
    );
    await expect(
      client.query(
        `INSERT INTO auth_accounts (id, issuer, account_id, provider_id, user_id)
         VALUES ('acc-2', 'local:credential', 'acct-dup', 'credential', 'u-1')`,
      ),
    ).rejects.toThrow();
  });

  it("rejects ambiguous duplicate Core User emails (case-insensitive)", async () => {
    const { client } = await createMigratedPglite();
    await client.query(
      `INSERT INTO core_users (id, auth_subject, email, display_name, status)
       VALUES ($1, 'sub-1', 'Admin@Example.com', 'One', 'ACTIVE')`,
      [createId()],
    );
    await expect(
      client.query(
        `INSERT INTO core_users (id, auth_subject, email, display_name, status)
         VALUES ($1, 'sub-2', 'admin@example.com', 'Two', 'ACTIVE')`,
        [createId()],
      ),
    ).rejects.toThrow();
  });

  it("membership self-update cannot change organization_id or user_id", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-sec-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "org-sec-b",
    });
    const ownerContext = await resolveActor(env, ownerA.headers, ownerA.organizationId);

    await signUp(env.auth, { email: "invitee@x.com", password: "password-123", name: "Invitee" });
    const inviteeHeaders = await signInHeaders(env.auth, {
      email: "invitee@x.com",
      password: "password-123",
    });
    const inviteeId = await userIdFromHeaders(env, inviteeHeaders);
    const attached = await attachUserByEmail(env.db, ownerContext.actor, {
      email: "invitee@x.com",
    });

    await env.client.query(`SELECT set_config('app.user_id', $1, false)`, [inviteeId]);
    await env.client.query(`SELECT set_config('app.organization_id', '', false)`);

    await expect(
      env.client.query(
        `UPDATE core_organization_memberships SET organization_id = $1 WHERE id = $2`,
        [ownerB.organizationId, attached.membershipId],
      ),
    ).rejects.toThrow();

    await expect(
      env.client.query(
        `UPDATE core_organization_memberships SET user_id = $1 WHERE id = $2`,
        [ownerA.userId, attached.membershipId],
      ),
    ).rejects.toThrow();
  });

  it("suspended membership cannot self-reactivate; invitation activation still works", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-act",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);

    const created = await createUserWithMembership(
      env.db,
      ownerContext.actor,
      { email: "staff@a.com", password: "password-123", displayName: "Staff" },
      createAuthAccountProvisioner(env.auth),
    );
    await setMembershipStatus(env.db, ownerContext.actor, created.membershipId, "suspend");

    await env.client.query(`SELECT set_config('app.user_id', $1, false)`, [created.userId]);
    await env.client.query(`SELECT set_config('app.organization_id', '', false)`);
    await env.client.query(
      `UPDATE core_organization_memberships SET status = 'ACTIVE' WHERE id = $1`,
      [created.membershipId],
    );
    const stillSuspended = await env.client.query<{ status: string }>(
      `SELECT status FROM core_organization_memberships WHERE id = $1`,
      [created.membershipId],
    );
    expect(stillSuspended.rows.map((row) => row.status)).toEqual(["SUSPENDED"]);

    await signUp(env.auth, { email: "invitee2@x.com", password: "password-123", name: "Invitee" });
    const inviteeHeaders = await signInHeaders(env.auth, {
      email: "invitee2@x.com",
      password: "password-123",
    });
    const inviteeId = await userIdFromHeaders(env, inviteeHeaders);
    const attached = await attachUserByEmail(env.db, ownerContext.actor, {
      email: "invitee2@x.com",
    });
    const activated = await activateInvitedMembership(env.db, inviteeId, owner.organizationId);
    expect(activated.membershipId).toBe(attached.membershipId);
  });

  it("unknown attach remains a ConflictError, not a not-found leak", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "org-conf",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    await expect(
      attachUserByEmail(env.db, ownerContext.actor, { email: "missing@x.com" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
