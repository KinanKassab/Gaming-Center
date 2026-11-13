import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { coreAuditLogs, coreOutboxEvents, financeCharges, financePayments, gamingSessions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createCustomer } from "@/modules/customers";
import { getSessionCheckout, recordSessionPayment } from "@/modules/finance";
import { listFloor, pauseSession, resumeSession, startSession, endSession, getSession } from "@/modules/gaming";
import { finalizeSessionBilling } from "@/modules/gaming";
import { createTestEnvironment, seedOwnerWithOrganization } from "../helpers/identity";
import { insertCompletedUnbilledSession, seedPlayableDevice } from "../helpers/gaming";

describe("pilot domain flow", () => {
  it("runs customer session pause/resume then settles a billed session with tenant ownership", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "pilot-e2e",
    });
    const other = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "pilot-e2e-b",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const customer = await createCustomer(env.db, seeded.context.actor, {
      displayName: "Pilot Customer",
      phone: "+963911111111",
    });

    const started = await startSession(env.db, seeded.context.actor, {
      deviceId: seeded.device.id,
      customerId: customer.customer.id,
    });
    expect(started.status).toBe("ACTIVE");
    expect(started.organizationId).toBe(owner.organizationId);
    expect(started.branchId).toBe(seeded.branch.id);

    const occupied = await listFloor(env.db, seeded.context.actor, { branchId: seeded.branch.id });
    expect(occupied.find((tile) => tile.deviceId === seeded.device.id)?.occupancy).toBe("OCCUPIED");

    await pauseSession(env.db, seeded.context.actor, started.id, { reason: "break" });
    await resumeSession(env.db, seeded.context.actor, started.id);
    const ended = await endSession(env.db, seeded.context.actor, started.id);
    expect(ended.status).toBe("COMPLETED");
    expect(ended.currentDeviceId).toBeNull();

    const endedAt = new Date();
    const billedId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: new Date(endedAt.getTime() - 90_000),
      endedAt,
      sessionNumber: "81",
      customerId: customer.customer.id,
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, billedId);
    const checkout = await getSessionCheckout(env.db, seeded.context.actor, billedId);
    expect(checkout.eligible).toBe(true);
    if (!checkout.remainingMinor || checkout.remainingMinor === "0") {
      throw new Error("expected a positive remaining amount");
    }

    const paid = await recordSessionPayment(
      env.db,
      seeded.context.actor,
      billedId,
      { amountMinor: checkout.remainingMinor, paymentMethodCode: "CASH" },
      "pilot-e2e-cash",
    );
    expect(paid.checkout.settlementStatus).toBe("PAID");

    const detail = await getSession(env.db, seeded.context.actor, billedId);
    expect(detail.session.status).toBe("COMPLETED");
    expect(detail.segments.length).toBeGreaterThan(0);

    const facts = await withTenant(env.db, owner.organizationId, async (tx) => {
      const session = await tx.select().from(gamingSessions).where(eq(gamingSessions.id, billedId));
      const charges = await tx.select().from(financeCharges).where(eq(financeCharges.sourceId, billedId));
      const payments = await tx.select().from(financePayments).where(eq(financePayments.branchId, seeded.branch.id));
      const audit = await tx.select({ action: coreAuditLogs.action }).from(coreAuditLogs);
      const outbox = await tx.select({ eventType: coreOutboxEvents.eventType }).from(coreOutboxEvents);
      return { session, charges, payments, audit, outbox };
    });
    expect(facts.session[0]?.organizationId).toBe(owner.organizationId);
    expect(facts.session[0]?.branchId).toBe(seeded.branch.id);
    expect(facts.charges[0]?.totalMinor).toBe(facts.session[0]?.gamingTotalMinor);
    expect(facts.payments[0]?.amountMinor).toBe(facts.session[0]?.gamingTotalMinor);
    expect(facts.audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "gaming.session.started",
        "gaming.session.paused",
        "gaming.session.resumed",
        "gaming.session.ended",
        "gaming.session.billing_finalized",
        "finance.payment.completed",
      ]),
    );
    expect(facts.outbox.map((row) => row.eventType)).toEqual(
      expect.arrayContaining(["gaming.session.started", "finance.payment.completed"]),
    );

    const hidden = await withTenant(env.db, other.organizationId, (tx) =>
      tx.select({ id: gamingSessions.id }).from(gamingSessions).where(eq(gamingSessions.id, billedId)),
    );
    expect(hidden).toHaveLength(0);
  });

  it("runs a guest session through full settlement", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "pilot-guest",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const started = await startSession(env.db, seeded.context.actor, { deviceId: seeded.device.id });
    expect(started.customerId).toBeNull();
    const ended = await endSession(env.db, seeded.context.actor, started.id);
    expect(ended.status).toBe("COMPLETED");

    const endedAt = new Date();
    const billedId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: new Date(endedAt.getTime() - 90_000),
      endedAt,
      sessionNumber: "82",
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, billedId);
    const checkout = await getSessionCheckout(env.db, seeded.context.actor, billedId);
    expect(checkout.guestMustPayInFull).toBe(true);
    if (!checkout.remainingMinor || checkout.remainingMinor === "0") {
      throw new Error("expected a positive remaining amount");
    }
    const paid = await recordSessionPayment(
      env.db,
      seeded.context.actor,
      billedId,
      { amountMinor: checkout.remainingMinor, paymentMethodCode: "CASH" },
      "pilot-guest-cash",
    );
    expect(paid.checkout.settlementStatus).toBe("PAID");
  });
});
