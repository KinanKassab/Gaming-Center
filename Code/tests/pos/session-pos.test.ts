import { describe, expect, it } from "vitest";
import { createCustomer } from "@/modules/customers";
import { createProduct, setProductPrice } from "@/modules/catalog";
import { getSessionCheckout, recordSessionPayment } from "@/modules/finance";
import { addDrinkToSession } from "@/modules/pos";
import { endSession, finalizeSessionBilling, startSession } from "@/modules/gaming";
import {
  createTestEnvironment,
  seedOwnerWithOrganization,
} from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

describe("session-linked POS + checkout", () => {
  it("keeps gaming total immutable and settles drinks with FIFO + guest full-pay", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "pos-owner@a.com",
      name: "POS Owner",
      slug: "pos-m9",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const actor = seeded.context.actor;

    const cola = await createProduct(env.db, actor, {
      name: "Cola",
      amountMinor: "15000",
      productType: "NON_STOCK",
      trackInventory: false,
    });
    const water = await createProduct(env.db, actor, {
      name: "Water",
      amountMinor: "10000",
      productType: "NON_STOCK",
      trackInventory: false,
    });
    const coffee = await createProduct(env.db, actor, {
      name: "Coffee",
      amountMinor: "20000",
      productType: "NON_STOCK",
      trackInventory: false,
    });

    const created = await createCustomer(env.db, actor, {
      displayName: "Cashier Customer",
      createdBranchId: seeded.branch.id,
    });

    const started = await startSession(env.db, actor, {
      deviceId: seeded.device.id,
      customerId: created.customer.id,
    });

    await addDrinkToSession(env.db, actor, started.id, { productId: cola.id, quantity: "1" });
    await addDrinkToSession(env.db, actor, started.id, { productId: water.id, quantity: "1" });
    await addDrinkToSession(env.db, actor, started.id, { productId: coffee.id, quantity: "1" });

    await endSession(env.db, actor, started.id);
    await finalizeSessionBilling(env.db, actor, started.id);

    const preview = await getSessionCheckout(env.db, actor, started.id);
    expect(preview.eligible).toBe(true);
    expect(preview.drinks).toHaveLength(3);
    expect(preview.guestMustPayInFull).toBe(false);
    const gamingTotal = preview.play!.totalMinor;
    const drinksTotal = preview.drinks.reduce((sum, row) => sum + BigInt(row.totalMinor), 0n);
    expect(drinksTotal).toBe(45000n);
    expect(BigInt(preview.billTotalMinor!)).toBe(BigInt(gamingTotal) + 45000n);

    const colaLine = preview.drinks.find((d) => d.description === "Cola")!;
    const waterLine = preview.drinks.find((d) => d.description === "Water")!;
    await recordSessionPayment(
      env.db,
      actor,
      started.id,
      {
        paymentMethodCode: "CASH",
        allocations: [
          { chargeId: colaLine.chargeId, amountMinor: "15000" },
          { chargeId: waterLine.chargeId, amountMinor: "5000" },
        ],
      },
      "pos-fifo-pay-20k",
    );

    const afterPartial = await getSessionCheckout(env.db, actor, started.id);
    expect(afterPartial.drinks.find((d) => d.description === "Cola")?.fullyPaid).toBe(true);
    expect(afterPartial.drinks.find((d) => d.description === "Water")?.paidMinor).toBe("5000");
    expect(afterPartial.drinks.find((d) => d.description === "Water")?.remainingMinor).toBe("5000");
    expect(afterPartial.drinks.find((d) => d.description === "Coffee")?.remainingMinor).toBe("20000");
    expect(afterPartial.play?.totalMinor).toBe(gamingTotal);

    // Pay remaining play only when the session accrued a positive gaming total.
    const playRemaining = BigInt(afterPartial.play!.remainingMinor);
    if (playRemaining > 0n) {
      await recordSessionPayment(
        env.db,
        actor,
        started.id,
        {
          paymentMethodCode: "CASH",
          amountMinor: afterPartial.play!.remainingMinor,
        },
        "pos-pay-gaming",
      );
    }

    const afterGaming = await getSessionCheckout(env.db, actor, started.id);
    expect(afterGaming.play?.remainingMinor).toBe("0");
    expect(afterGaming.play?.totalMinor).toBe(gamingTotal);

    const drinkRest = afterGaming.drinks
      .filter((d) => BigInt(d.remainingMinor) > 0n)
      .map((d) => ({ chargeId: d.chargeId, amountMinor: d.remainingMinor }));
    const settled = await recordSessionPayment(
      env.db,
      actor,
      started.id,
      { paymentMethodCode: "CASH", allocations: drinkRest },
      "pos-pay-drinks-rest",
    );
    expect(settled.checkout.remainingMinor).toBe("0");
    expect(settled.checkout.settlementStatus).toBe("PAID");
    expect(settled.checkout.play?.totalMinor).toBe(gamingTotal);
  });

  it("rejects guest partial payment across play + drinks", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "guest-pos@a.com",
      name: "Guest POS",
      slug: "pos-guest",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const actor = seeded.context.actor;
    const cola = await createProduct(env.db, actor, {
      name: "Cola",
      amountMinor: "15000",
      productType: "NON_STOCK",
      trackInventory: false,
    });
    const started = await startSession(env.db, actor, { deviceId: seeded.device.id });
    await addDrinkToSession(env.db, actor, started.id, { productId: cola.id, quantity: "1" });
    await endSession(env.db, actor, started.id);
    await finalizeSessionBilling(env.db, actor, started.id);

    const preview = await getSessionCheckout(env.db, actor, started.id);
    expect(preview.guestMustPayInFull).toBe(true);
    const drink = preview.drinks[0]!;
    await expect(
      recordSessionPayment(
        env.db,
        actor,
        started.id,
        {
          paymentMethodCode: "CASH",
          allocations: [{ chargeId: drink.chargeId, amountMinor: "5000" }],
        },
        "guest-partial-drinks-only",
      ),
    ).rejects.toMatchObject({ reason: "guest_must_pay_in_full" });
  });

  it("resolves branch price overrides into order snapshots", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "price-owner@a.com",
      name: "Price Owner",
      slug: "pos-price",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const actor = seeded.context.actor;
    const product = await createProduct(env.db, actor, {
      name: "Juice",
      amountMinor: "3000",
      productType: "NON_STOCK",
      trackInventory: false,
    });
    await setProductPrice(env.db, actor, {
      productId: product.id,
      amountMinor: "2500",
      branchId: seeded.branch.id,
    });

    const started = await startSession(env.db, actor, { deviceId: seeded.device.id });
    const sale = await addDrinkToSession(env.db, actor, started.id, {
      productId: product.id,
      quantity: "1",
    });
    expect(sale.unitAmountMinor).toBe("2500");
    expect(sale.totalMinor).toBe("2500");
  });
});
