import { describe, expect, it } from "vitest";
import { createBranch, PERMISSIONS } from "@/modules/identity";
import { createCustomer } from "@/modules/customers";
import { getCustomerStatement, getPortalStatement, postCustomerLedgerEntry } from "@/modules/finance";
import { createTestEnvironment, resolveActor, seedOwnerWithOrganization } from "../helpers/identity";

describe("customer ledger", () => {
  it("records an opening debt, a drink, and a payment without storing only a balance", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "ledger-open",
    });
    const before = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, before.actor, { name: "Main" });
    const actor = await resolveActor(env, owner.headers, owner.organizationId);

    const first = await createCustomer(env.db, actor.actor, {
      displayName: "Ahmad",
      phone: "0991000000",
      createdBranchId: branch.id,
      openingSide: "DEBTOR",
      openingAmountMinor: "5000",
    });
    const duplicate = await createCustomer(env.db, actor.actor, {
      displayName: "ahmad",
      phone: "0991000000",
      createdBranchId: branch.id,
    });
    expect(duplicate.customer.id).not.toBe(first.customer.id);
    expect(duplicate.warnings.map((row) => row.code).sort()).toEqual(["DUPLICATE_NAME", "DUPLICATE_PHONE"]);
    expect(first.customer.portalToken).not.toBe(first.customer.id);

    const afterDrink = await postCustomerLedgerEntry(env.db, actor.actor, first.customer.id, {
      branchId: branch.id,
      kind: "DRINK",
      amountMinor: "1500",
      description: "Tea",
      idempotencyKey: "drink-tea-0001",
    });
    expect(afterDrink.statement.balanceMinor).toBe("6500");
    expect(afterDrink.statement.position).toBe("DEBTOR");

    const afterPay = await postCustomerLedgerEntry(env.db, actor.actor, first.customer.id, {
      branchId: branch.id,
      kind: "PAYMENT",
      amountMinor: "2000",
      description: "Cash payment",
      idempotencyKey: "pay-cash-0001",
    });
    expect(afterPay.statement.lines.map((line) => line.entryKind)).toEqual(["OPENING_DEBT", "DRINK", "PAYMENT"]);
    expect(afterPay.statement.balanceMinor).toBe("4500");

    const replay = await postCustomerLedgerEntry(env.db, actor.actor, first.customer.id, {
      branchId: branch.id,
      kind: "PAYMENT",
      amountMinor: "2000",
      description: "Cash payment",
      idempotencyKey: "pay-cash-0001",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.statement.balanceMinor).toBe("4500");

    const portal = await getPortalStatement(env.db, first.customer.portalToken);
    expect(portal?.displayName).toBe("Ahmad");
    expect(portal?.balanceMinor).toBe("4500");
    expect(portal && "id" in portal).toBe(false);

    const byCustomerId = await getPortalStatement(env.db, first.customer.id);
    expect(byCustomerId).toBeNull();

    const staff = await getCustomerStatement(env.db, actor.actor, first.customer.id);
    expect(staff.lines).toHaveLength(3);
    expect(actor.actor.permissions).toContain(PERMISSIONS.customersRead);
  });

  it("records opening credit as money the center owes the customer", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "ledger-credit",
    });
    const before = await resolveActor(env, owner.headers, owner.organizationId);
    const branch = await createBranch(env.db, before.actor, { name: "Main" });
    const actor = await resolveActor(env, owner.headers, owner.organizationId);
    const created = await createCustomer(env.db, actor.actor, {
      displayName: "Lina",
      createdBranchId: branch.id,
      openingSide: "CREDITOR",
      openingAmountMinor: "3000",
    });
    const statement = await getCustomerStatement(env.db, actor.actor, created.customer.id);
    expect(statement.position).toBe("CREDITOR");
    expect(statement.balanceMinor).toBe("-3000");
    expect(statement.lines[0]?.entryKind).toBe("OPENING_CREDIT");
  });
});
