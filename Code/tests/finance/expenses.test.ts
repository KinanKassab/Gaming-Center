import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, ValidationError } from "@/core/errors";
import { coreAuditLogs, coreOutboxEvents, financeExpenses } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { recordExpense, sumPostedExpenses } from "@/modules/finance";
import { createBranch, PERMISSIONS } from "@/modules/identity";
import {
  createStaffMember,
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";

describe("finance expenses", () => {
  it("posts a cash till withdrawal, sums the day, and rejects a zero amount", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "exp-post",
    });
    let context = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, context.actor, { name: "Main" });
    context = await resolveActor(env, owner.headers, owner.organizationId);

    const recorded = await recordExpense(
      env.db,
      context.actor,
      { branchId: branch.id, amountMinor: "15000", description: "Tea for the hall" },
      "expense-key-01",
    );
    expect(recorded.replayed).toBe(false);
    expect(recorded.expense.amountMinor).toBe("15000");
    expect(recorded.expense.currency).toBe("SYP");
    expect(recorded.expense.categoryCode).toBe("PURCHASE");
    expect(recorded.expense.paymentMethodCode).toBe("CASH");
    expect(recorded.expense.status).toBe("POSTED");
    expect(recorded.expense.description).toBe("Tea for the hall");

    const replay = await recordExpense(
      env.db,
      context.actor,
      { branchId: branch.id, amountMinor: "15000", description: "Tea for the hall" },
      "expense-key-01",
    );
    expect(replay.replayed).toBe(true);
    expect(replay.expense.id).toBe(recorded.expense.id);

    await expect(
      recordExpense(
        env.db,
        context.actor,
        { branchId: branch.id, amountMinor: "1", description: "Different" },
        "expense-key-01",
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const second = await recordExpense(
      env.db,
      context.actor,
      { branchId: branch.id, amountMinor: "5000", description: "Sugar" },
      "expense-key-02",
    );
    expect(second.replayed).toBe(false);

    const from = new Date("2000-01-01T00:00:00.000Z");
    const to = new Date("2100-01-01T00:00:00.000Z");
    const sum = await sumPostedExpenses(env.db, context.actor, { branchId: branch.id, from, to });
    expect(sum.totalMinor).toBe(20000n);
    expect(sum.currency).toBe("SYP");

    const stored = await withTenant(env.db, owner.organizationId, (tx) =>
      tx.select().from(financeExpenses),
    );
    expect(stored).toHaveLength(2);

    const audit = await withTenant(env.db, owner.organizationId, (tx) =>
      tx.select({ action: coreAuditLogs.action }).from(coreAuditLogs),
    );
    expect(audit.some((row) => row.action === "finance.expense.posted")).toBe(true);

    const outbox = await withTenant(env.db, owner.organizationId, (tx) =>
      tx.select({ eventType: coreOutboxEvents.eventType }).from(coreOutboxEvents),
    );
    expect(outbox.some((row) => row.eventType === "finance.expense.posted")).toBe(true);

    await expect(
      recordExpense(
        env.db,
        context.actor,
        { branchId: branch.id, amountMinor: "0", description: "Nothing" },
        "expense-key-zero",
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("hides another tenant’s branch and blocks VIEW-only staff from posting", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "exp-iso-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "exp-iso-b",
    });
    let contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    const branchA = await createBranch(env.db, contextA.actor, { name: "Jaramana" });
    contextA = await resolveActor(env, ownerA.headers, ownerA.organizationId);
    const contextB = await resolveActor(env, ownerB.headers, ownerB.organizationId);

    await expect(
      recordExpense(
        env.db,
        contextB.actor,
        { branchId: branchA.id, amountMinor: "1000", description: "Cross tenant" },
        "expense-key-b",
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const viewer = await createStaffMember(env, ownerA, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "EXP_VIEW",
      permissions: [PERMISSIONS.financeExpensesRead],
      branches: [{ branchId: branchA.id, accessMode: "VIEW" }],
    });
    const viewActor = await resolveActor(env, viewer.headers, ownerA.organizationId);
    await expect(
      recordExpense(
        env.db,
        viewActor.actor,
        { branchId: branchA.id, amountMinor: "1000", description: "Viewer buy" },
        "expense-key-view",
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const from = new Date("2000-01-01T00:00:00.000Z");
    const to = new Date("2100-01-01T00:00:00.000Z");
    const empty = await sumPostedExpenses(env.db, contextA.actor, { branchId: branchA.id, from, to });
    expect(empty.totalMinor).toBe(0n);
  });
});
