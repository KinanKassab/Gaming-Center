import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { createId } from "@/core/ids";
import { coreCustomers, coreUsers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createBranch, listAuditLogs, PERMISSIONS } from "@/modules/identity";
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  listCustomerPage,
  listCustomers,
  updateCustomer,
} from "@/modules/customers";
import {
  createStaffMember,
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";

describe("customers", () => {
  it("creates, reads, searches, updates, and archives a customer", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "cust-crud",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const created = await createCustomer(env.db, context.actor, {
      displayName: "Ahmad Ali",
      phone: "+963 11 123 4567",
      email: "Ahmad@Example.COM",
      notes: " VIP ",
    });
    expect(created.customer.phoneNormalized).toBe("+963111234567");
    expect(created.customer.emailNormalized).toBe("ahmad@example.com");
    expect(created.customer.notes).toBe("VIP");
    expect(created.warnings).toEqual([]);

    const fetched = await getCustomer(env.db, context.actor, created.customer.id);
    expect(fetched.displayName).toBe("Ahmad Ali");

    const byName = await listCustomers(env.db, context.actor, { q: "Ahmad" });
    expect(byName.map((row) => row.id)).toContain(created.customer.id);
    const byPhone = await listCustomers(env.db, context.actor, { q: "111234" });
    expect(byPhone.map((row) => row.id)).toContain(created.customer.id);

    const updated = await updateCustomer(env.db, context.actor, created.customer.id, {
      displayName: "Ahmad",
      status: "BLOCKED",
    });
    expect(updated.customer.status).toBe("BLOCKED");

    const archived = await archiveCustomer(env.db, context.actor, created.customer.id);
    expect(archived.status).toBe("ARCHIVED");
    const listed = await listCustomers(env.db, context.actor);
    expect(listed.map((row) => row.id)).not.toContain(created.customer.id);
    const archivedList = await listCustomers(env.db, context.actor, { status: "ARCHIVED" });
    expect(archivedList.map((row) => row.id)).toContain(created.customer.id);

    await expect(
      updateCustomer(env.db, context.actor, created.customer.id, { displayName: "Nope" }),
    ).rejects.toThrow(ConflictError);
  });

  it("warns on duplicate phone or email without blocking or merging", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "cust-dup",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const first = await createCustomer(env.db, context.actor, {
      displayName: "One",
      phone: "0991112222",
      email: "same@example.com",
    });
    const second = await createCustomer(env.db, context.actor, {
      displayName: "Two",
      phone: "0991112222",
      email: "same@example.com",
    });
    expect(second.customer.id).not.toBe(first.customer.id);
    expect(second.warnings.map((row) => row.code).sort()).toEqual(["DUPLICATE_EMAIL", "DUPLICATE_PHONE"]);
  });

  it("rejects invalid input", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "cust-invalid",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    await expect(createCustomer(env.db, context.actor, { displayName: "   " })).rejects.toThrow();
    await expect(
      createCustomer(env.db, context.actor, { displayName: "Ahmad", email: "not-an-email" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createCustomer(env.db, context.actor, { displayName: "Ahmad", phone: "12" }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects missing permission and does not create an auth account", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "cust-perm",
    });
    const staff = await createStaffMember(env, owner, {
      email: "reader@a.com",
      displayName: "Reader",
      roleCode: "CUST_READ",
      permissions: [PERMISSIONS.customersRead],
    });
    const staffContext = await resolveActor(env, staff.headers, owner.organizationId);
    await expect(
      createCustomer(env.db, staffContext.actor, { displayName: "Guest" }),
    ).rejects.toThrow(AuthorizationError);
    const listed = await listCustomers(env.db, staffContext.actor);
    expect(listed).toEqual([]);

    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const created = await createCustomer(env.db, ownerContext.actor, {
      displayName: "Walk-in",
      email: "walkin@example.com",
    });
    const authUsers = await env.client.query(
      `SELECT id FROM auth_users WHERE email = $1`,
      ["walkin@example.com"],
    );
    expect(authUsers.rows).toEqual([]);
    expect(created.customer.id).toBeTruthy();
  });

  it("rejects a cross-tenant customer UUID as not found", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "cust-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "cust-iso-b",
    });
    const contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);
    const customerB = await createCustomer(env.db, contextB.actor, { displayName: "Secret" });
    await expect(getCustomer(env.db, contextA.actor, customerB.customer.id)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      updateCustomer(env.db, contextA.actor, customerB.customer.id, { displayName: "Stolen" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects associating a customer with a branch the actor cannot access", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "cust-branch",
    });
    const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
    const jaramana = await createBranch(env.db, ownerContext.actor, { code: "JRM", name: "Jaramana" });
    const mezzeh = await createBranch(env.db, ownerContext.actor, { code: "MZH", name: "Mezzeh" });
    const staff = await createStaffMember(env, owner, {
      email: "staff@a.com",
      displayName: "Staff",
      roleCode: "CUST_MGR",
      permissions: [PERMISSIONS.customersRead, PERMISSIONS.customersManage],
      branches: [{ branchId: jaramana.id, accessMode: "VIEW" }],
    });
    const staffContext = await resolveActor(env, staff.headers, owner.organizationId);
    const ok = await createCustomer(env.db, staffContext.actor, {
      displayName: "Local",
      createdBranchId: jaramana.id,
    });
    expect(ok.customer.createdBranchId).toBe(jaramana.id);
    await expect(
      createCustomer(env.db, staffContext.actor, {
        displayName: "Other branch",
        createdBranchId: mezzeh.id,
      }),
    ).rejects.toThrow(AuthorizationError);
  });

  it("paginates deterministically with search, status, and tenant filters", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner-a@pages.test",
      name: "Owner A",
      slug: "customer-pages-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner-b@pages.test",
      name: "Owner B",
      slug: "customer-pages-b",
    });
    const contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);

    await withTenant(env.db, {
      organizationId: ownerA.organizationId,
      userId: contextA.actor.userId,
    }, async (tx) => {
      await tx.insert(coreCustomers).values(
        Array.from({ length: 105 }, (_, index) => ({
          id: createId(),
          organizationId: ownerA.organizationId,
          displayName: `Batch ${String(index).padStart(3, "0")}`,
          status: index % 2 === 0 ? "BLOCKED" : "ACTIVE",
          portalToken: createId(),
        })),
      );
    });
    await createCustomer(env.db, contextB.actor, { displayName: "Batch 000 foreign tenant" });

    const first = await listCustomerPage(env.db, contextA.actor, { limit: 20 });
    const middle = await listCustomerPage(env.db, contextA.actor, { limit: 20, offset: 40 });
    const last = await listCustomerPage(env.db, contextA.actor, { limit: 20, offset: 100 });
    const empty = await listCustomerPage(env.db, contextA.actor, { limit: 20, offset: 105 });
    const search = await listCustomerPage(env.db, contextA.actor, { q: "Batch 0", limit: 10, offset: 20 });
    const status = await listCustomerPage(env.db, contextA.actor, {
      status: "BLOCKED",
      limit: 10,
      offset: 20,
    });

    expect(first.customers.map((row) => row.displayName)).toEqual(
      Array.from({ length: 20 }, (_, index) => `Batch ${String(index).padStart(3, "0")}`),
    );
    expect(first.hasMore).toBe(true);
    expect(middle.customers[0]?.displayName).toBe("Batch 040");
    expect(middle.customers.at(-1)?.displayName).toBe("Batch 059");
    expect(last.customers.map((row) => row.displayName)).toEqual([
      "Batch 100",
      "Batch 101",
      "Batch 102",
      "Batch 103",
      "Batch 104",
    ]);
    expect(last.hasMore).toBe(false);
    expect(empty.customers).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(search.customers.map((row) => row.displayName)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Batch ${String(index + 20).padStart(3, "0")}`),
    );
    expect(status.customers.map((row) => row.displayName)).toEqual([
      "Batch 040",
      "Batch 042",
      "Batch 044",
      "Batch 046",
      "Batch 048",
      "Batch 050",
      "Batch 052",
      "Batch 054",
      "Batch 056",
      "Batch 058",
    ]);
    expect(first.customers.some((row) => row.organizationId !== ownerA.organizationId)).toBe(false);
  });

  it("audits customer mutations", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "cust-audit",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const created = await createCustomer(env.db, context.actor, { displayName: "Ahmad" });
    await updateCustomer(env.db, context.actor, created.customer.id, { notes: "hello" });
    await archiveCustomer(env.db, context.actor, created.customer.id);
    const logs = await listAuditLogs(env.db, context.actor, { limit: 50 });
    expect(logs.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "core.customer.created",
        "core.customer.updated",
        "core.customer.archived",
      ]),
    );
  });

  it("does not treat customers as memberships", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "cust-nomem",
    });
    const context = await resolveActor(env, owner.headers, owner.organizationId);
    const created = await createCustomer(env.db, context.actor, {
      displayName: "Not a user",
      email: "notuser@example.com",
    });
    const core = await env.db.select().from(coreUsers).where(eq(coreUsers.email, "notuser@example.com"));
    expect(core).toEqual([]);
    expect(created.customer.id).not.toBe(owner.userId);
  });
});
