import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/core/errors";
import { coreAuditLogs, coreOutboxEvents, financePayments, gamingSessions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createCustomer } from "@/modules/customers";
import { getPayment, getSessionCheckout, recordSessionPayment } from "@/modules/finance";
import { PERMISSIONS } from "@/modules/identity";
import { cancelSession, finalizeSessionBilling, startSession } from "@/modules/gaming";
import {
  createStaffMember,
  createTestEnvironment,
  resolveActor,
  seedOwnerWithOrganization,
} from "../helpers/identity";
import { insertCompletedUnbilledSession, seedPlayableDevice } from "../helpers/gaming";

const T0 = new Date("2026-01-01T10:00:00.000Z");
function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

async function finalizedGuestSession(
  env: Awaited<ReturnType<typeof createTestEnvironment>>,
  owner: Awaited<ReturnType<typeof seedOwnerWithOrganization>>,
  sessionNumber: string,
) {
  const seeded = await seedPlayableDevice(env, owner);
  const sessionId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
    branchId: seeded.branch.id,
    deviceId: seeded.device.id,
    plan: seeded.plan,
    startedAt: at(0),
    endedAt: at(90),
    sessionNumber,
  });
  await finalizeSessionBilling(env.db, seeded.context.actor, sessionId);
  return { ...seeded, sessionId };
}

describe("finance checkout", () => {
  it("records a full cash payment against the finalized M6 total and does not rewrite the bill", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "pay-full",
    });
    const seeded = await finalizedGuestSession(env, owner, "91");
    const preview = await getSessionCheckout(env.db, seeded.context.actor, seeded.sessionId);
    expect(preview.eligible).toBe(true);
    expect(preview.settlementStatus).toBe("UNPAID");
    expect(preview.billTotalMinor).toBe("200");
    expect(preview.remainingMinor).toBe("200");
    expect(preview.currency).toBe("SYP");
    expect(preview.guestMustPayInFull).toBe(true);
    expect(preview.methods.map((row) => row.code).sort()).toEqual(["CASH", "SHAMCASH"]);
    expect(preview.methods.find((row) => row.code === "SHAMCASH")?.integration).toBe(
      "NEEDS_VERIFICATION",
    );

    const recorded = await recordSessionPayment(
      env.db,
      seeded.context.actor,
      seeded.sessionId,
      { amountMinor: "200", paymentMethodCode: "CASH" },
      "pay-full-key-01",
    );
    expect(recorded.replayed).toBe(false);
    expect(recorded.payment.amountMinor).toBe("200");
    expect(recorded.payment.paymentMethodCode).toBe("CASH");
    expect(recorded.checkout.settlementStatus).toBe("PAID");
    expect(recorded.checkout.remainingMinor).toBe("0");
    expect(recorded.checkout.guestMustPayInFull).toBe(true);

    const sessions = await withTenant(env.db, owner.organizationId, (tx) =>
      tx
        .select({ total: gamingSessions.gamingTotalMinor, currency: gamingSessions.billingCurrency })
        .from(gamingSessions)
        .where(eq(gamingSessions.id, seeded.sessionId)),
    );
    expect(sessions[0]?.total).toBe(200n);
    expect(sessions[0]?.currency).toBe("SYP");

    const audit = await withTenant(env.db, owner.organizationId, (tx) =>
      tx.select({ action: coreAuditLogs.action }).from(coreAuditLogs).where(eq(coreAuditLogs.entityId, recorded.payment.id)),
    );
    expect(audit.map((row) => row.action)).toContain("finance.payment.completed");
    const outbox = await withTenant(env.db, owner.organizationId, (tx) =>
      tx
        .select({ eventType: coreOutboxEvents.eventType })
        .from(coreOutboxEvents)
        .where(eq(coreOutboxEvents.aggregateId, recorded.payment.id)),
    );
    expect(outbox.map((row) => row.eventType)).toContain("finance.payment.completed");
  });

  it("replays an identical idempotent request and rejects a contradictory reuse", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "pay-idem",
    });
    const seeded = await finalizedGuestSession(env, owner, "92");
    const first = await recordSessionPayment(
      env.db,
      seeded.context.actor,
      seeded.sessionId,
      { amountMinor: "200", paymentMethodCode: "CASH" },
      "same-key-aaaa",
    );
    const second = await recordSessionPayment(
      env.db,
      seeded.context.actor,
      seeded.sessionId,
      { amountMinor: "200", paymentMethodCode: "CASH" },
      "same-key-aaaa",
    );
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);

    const counted = await withTenant(env.db, owner.organizationId, (tx) =>
      tx.select({ id: financePayments.id }).from(financePayments),
    );
    expect(counted).toHaveLength(1);

    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        seeded.sessionId,
        { amountMinor: "200", paymentMethodCode: "SHAMCASH" },
        "same-key-aaaa",
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("allows customer split payments and rejects guest partial payment and overpayment", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "pay-split",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const guestId = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "93",
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, guestId);
    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        guestId,
        { amountMinor: "50", paymentMethodCode: "CASH" },
        "guest-partial",
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/paid in full/i),
      reason: "guest_must_pay_in_full",
    });

    const customer = await createCustomer(env.db, seeded.context.actor, { displayName: "Player" });
    const billed = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "94",
      customerId: customer.customer.id,
    });
    await finalizeSessionBilling(env.db, seeded.context.actor, billed);
    const first = await recordSessionPayment(
      env.db,
      seeded.context.actor,
      billed,
        { amountMinor: "80", paymentMethodCode: "CASH" },
        "customer-part-1",
      );
    expect(first.checkout.settlementStatus).toBe("PARTIALLY_PAID");
    expect(first.checkout.remainingMinor).toBe("120");
    const second = await recordSessionPayment(
      env.db,
      seeded.context.actor,
      billed,
      { amountMinor: "120", paymentMethodCode: "SHAMCASH", externalReference: "staff-ref-1" },
      "customer-part-2",
    );
    expect(second.payment.recordingNote).toMatch(/Not verified by a payment provider API/);
    expect(second.checkout.settlementStatus).toBe("PAID");
    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        billed,
        { amountMinor: "1", paymentMethodCode: "CASH" },
        "customer-part-3",
      ),
    ).rejects.toThrow(/already settled/i);
  });

  it("rejects zero amount, currency mismatch, unsupported method, open, cancelled, and unfinalized bills", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "pay-reject",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const unbilled = await insertCompletedUnbilledSession(env, seeded.context.actor, {
      branchId: seeded.branch.id,
      deviceId: seeded.device.id,
      plan: seeded.plan,
      startedAt: at(0),
      endedAt: at(90),
      sessionNumber: "95",
    });
    const preview = await getSessionCheckout(env.db, seeded.context.actor, unbilled);
    expect(preview.eligible).toBe(false);
    expect(preview.reason).toBe("BILLING_NOT_FINALIZED");
    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        unbilled,
        { amountMinor: "200", paymentMethodCode: "CASH" },
        "unbilled-key",
      ),
    ).rejects.toThrow(ConflictError);

    await finalizeSessionBilling(env.db, seeded.context.actor, unbilled);
    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        unbilled,
        { amountMinor: "0", paymentMethodCode: "CASH" },
        "zero-amount",
      ),
    ).rejects.toMatchObject({
      name: "ValidationError",
      reason: "payment_amount_not_positive",
    });
    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        unbilled,
        { amountMinor: "200", currency: "USD", paymentMethodCode: "CASH" },
        "fx-mismatch",
      ),
    ).rejects.toThrow(/currency/i);
    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        unbilled,
        { amountMinor: "200", paymentMethodCode: "VISA" },
        "visa-method",
      ),
    ).rejects.toThrow(/unsupported/i);
    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        unbilled,
        { amountMinor: "201", paymentMethodCode: "CASH" },
        "over-amount",
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/exceeds remaining/i),
      reason: "payment_exceeds_remaining",
    });

    const open = await startSession(env.db, seeded.context.actor, { deviceId: seeded.device.id });
    const openCheckout = await getSessionCheckout(env.db, seeded.context.actor, open.id);
    expect(openCheckout.eligible).toBe(false);
    expect(openCheckout.reason).toBe("OPEN_SESSION");
    await expect(
      recordSessionPayment(
        env.db,
        seeded.context.actor,
        open.id,
        { amountMinor: "1", paymentMethodCode: "CASH" },
        "open-session",
      ),
    ).rejects.toThrow(ConflictError);

    await cancelSession(env.db, seeded.context.actor, open.id, { reason: "Walked away" });
    const cancelledCheckout = await getSessionCheckout(env.db, seeded.context.actor, open.id);
    expect(cancelledCheckout.eligible).toBe(false);
    expect(cancelledCheckout.reason).toBe("CANCELLED_SESSION");
  });

  it("enforces VIEW vs OPERATE and hides a cross-tenant payment id", async () => {
    const env = await createTestEnvironment();
    const ownerA = await seedOwnerWithOrganization(env, {
      email: "owner@a.com",
      name: "Owner A",
      slug: "pay-auth-a",
    });
    const ownerB = await seedOwnerWithOrganization(env, {
      email: "owner@b.com",
      name: "Owner B",
      slug: "pay-auth-b",
    });
    const seededA = await finalizedGuestSession(env, ownerA, "96");
    await seedPlayableDevice(env, ownerB, { branchCode: "MZB" });

    const viewer = await createStaffMember(env, ownerA, {
      email: "view@a.com",
      displayName: "Viewer",
      roleCode: "PAY_VIEW",
      permissions: [PERMISSIONS.gamingSessionsRead, PERMISSIONS.financePaymentsRead],
      branches: [{ branchId: seededA.branch.id, accessMode: "VIEW" }],
    });
    const viewActor = (await resolveActor(env, viewer.headers, ownerA.organizationId)).actor;
    const viewed = await getSessionCheckout(env.db, viewActor, seededA.sessionId);
    expect(viewed.billTotalMinor).toBe("200");
    await expect(
      recordSessionPayment(
        env.db,
        viewActor,
        seededA.sessionId,
        { amountMinor: "200", paymentMethodCode: "CASH" },
        "view-pay",
      ),
    ).rejects.toThrow(AuthorizationError);

    const operator = await createStaffMember(env, ownerA, {
      email: "op@a.com",
      displayName: "Operator",
      roleCode: "PAY_OP",
      permissions: [PERMISSIONS.gamingSessionsRead, PERMISSIONS.financePaymentsCreate],
      branches: [{ branchId: seededA.branch.id, accessMode: "OPERATE" }],
    });
    const opActor = (await resolveActor(env, operator.headers, ownerA.organizationId)).actor;
    const paid = await recordSessionPayment(
      env.db,
      opActor,
      seededA.sessionId,
      { amountMinor: "200", paymentMethodCode: "CASH" },
        "operate-pay",
    );

    const otherBranch = await createStaffMember(env, ownerA, {
      email: "other@a.com",
      displayName: "Other branch",
      roleCode: "PAY_OTHER",
      permissions: [PERMISSIONS.gamingSessionsRead, PERMISSIONS.financePaymentsCreate],
      branches: [],
    });
    const otherActor = (await resolveActor(env, otherBranch.headers, ownerA.organizationId)).actor;
    await expect(getSessionCheckout(env.db, otherActor, seededA.sessionId)).rejects.toThrow(
      AuthorizationError,
    );

    const actorB = (await resolveActor(env, ownerB.headers, ownerB.organizationId)).actor;
    await expect(getSessionCheckout(env.db, actorB, seededA.sessionId)).rejects.toThrow(NotFoundError);
    await expect(getPayment(env.db, actorB, paid.payment.id)).rejects.toThrow(NotFoundError);
  });
});
