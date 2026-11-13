import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  isCheckViolation,
} from "@/core/errors";
import { createId } from "@/core/ids";
import { addMinor, assertInt64Minor, parseMinorUnits, subtractMinor, type MinorUnits } from "@/core/money";
import { assertPermission } from "@/core/tenancy";
import {
  coreBranches,
  coreIdempotencyKeys,
  coreOutboxEvents,
  financeChargeItems,
  financeCharges,
  financePaymentAllocations,
  financePaymentMethods,
  financePayments,
  gamingSessionOrderLinks,
  gamingSessions,
  posOrders,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { requireBranchAccess } from "@/modules/gaming/access";
import { appendCustomerLedgerEntry } from "./customer-ledger";
import { deriveFifoItemSettlements } from "./fifo";
import {
  listActivePaymentMethods,
  loadActivePaymentMethodByCode,
} from "./methods";

export const PAYMENT_IDEMPOTENCY_SCOPE = "finance.payments";
export const IDEMPOTENCY_KEY_MAX = 128;
export const IDEMPOTENCY_KEY_MIN = 8;

const GAMING_CHARGE_SOURCE_MODULE = "gaming";
const GAMING_CHARGE_SOURCE_TYPE = "session";
export const POS_CHARGE_SOURCE_MODULE = "pos";
export const POS_CHARGE_SOURCE_TYPE = "order";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(IDEMPOTENCY_KEY_MIN, "Idempotency-Key is too short")
  .max(IDEMPOTENCY_KEY_MAX, "Idempotency-Key is too long")
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency-Key contains unsupported characters");

export const recordSessionPaymentInputSchema = z
  .object({
    amountMinor: z.string().trim().regex(/^\d+$/, "amountMinor must be a non-negative integer string").optional(),
    allocations: z
      .array(
        z.object({
          chargeId: z.string().regex(UUID_PATTERN, "Invalid charge id"),
          amountMinor: z.string().trim().regex(/^[1-9]\d*$/, "allocation amount must be a positive integer string"),
        }),
      )
      .min(1)
      .max(50)
      .optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code")
      .optional(),
    paymentMethodCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{0,31}$/, "Unsupported payment method"),
    externalReference: z.string().trim().min(1).max(128).optional().nullable(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .refine((body) => Boolean(body.allocations?.length) || body.amountMinor != null, {
    message: "Provide allocations or amountMinor",
  });

export type RecordSessionPaymentInput = z.infer<typeof recordSessionPaymentInputSchema>;

export type SettlementStatus = "INELIGIBLE" | "UNPAID" | "PARTIALLY_PAID" | "PAID";

export type PaymentMethodJson = {
  id: string;
  code: string;
  name: string;
  methodType: string;
  requiresReference: boolean;
  recordingMode: "MANUAL" | "CASH";
  integration: "NONE" | "NEEDS_VERIFICATION";
};

export type PaymentJson = {
  id: string;
  chargeId: string;
  sessionId: string;
  amountMinor: string;
  currency: string;
  status: "COMPLETED";
  paymentMethodCode: string;
  paymentMethodName: string;
  paymentMethodType: string;
  externalReference: string | null;
  receivedAt: string;
  createdBy: string;
  recordingNote: string | null;
};

export type SessionCheckoutView = {
  sessionId: string;
  eligible: boolean;
  reason: string | null;
  settlementStatus: SettlementStatus;
  /** Combined gaming + linked POS totals when eligible. */
  billTotalMinor: string | null;
  appliedMinor: string | null;
  remainingMinor: string | null;
  currency: string | null;
  billingFinalizedAt: string | null;
  chargeId: string | null;
  customerId: string | null;
  guest: boolean;
  guestMustPayInFull: boolean;
  methods: PaymentMethodJson[];
  payments: PaymentJson[];
  playingStartedAt: string | null;
  playingEndedAt: string | null;
  play: {
    chargeId: string | null;
    totalMinor: string;
    appliedMinor: string;
    remainingMinor: string;
  } | null;
  drinks: Array<{
    orderId: string;
    orderItemId: string;
    chargeId: string;
    chargeItemId: string;
    description: string;
    totalMinor: string;
    paidMinor: string;
    remainingMinor: string;
    fullyPaid: boolean;
  }>;
};

type SessionRow = typeof gamingSessions.$inferSelect;
type ChargeRow = typeof financeCharges.$inferSelect;
type PaymentRow = typeof financePayments.$inferSelect;

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function transactionNow(tx: AppDatabase): Promise<Date> {
  const rows = await tx.select({ now: sql<Date>`now()` }).from(coreBranches).limit(1);
  const value = rows[0]?.now;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

async function loadOwnSession(
  tx: AppDatabase,
  organizationId: string,
  sessionId: string,
): Promise<SessionRow> {
  const rows = await tx
    .select()
    .from(gamingSessions)
    .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Session not found");
  return row;
}

async function lockSession(
  tx: AppDatabase,
  organizationId: string,
  sessionId: string,
): Promise<SessionRow> {
  await tx.execute(
    sql`select id from gaming_sessions where id = ${sessionId} and organization_id = ${organizationId} for update`,
  );
  return loadOwnSession(tx, organizationId, sessionId);
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function methodJson(row: {
  id: string;
  code: string;
  name: string;
  methodType: string;
  requiresReference: boolean;
  config: unknown;
}): PaymentMethodJson {
  const config = row.config && typeof row.config === "object" ? (row.config as Record<string, unknown>) : {};
  const integration = config.integration === "NEEDS_VERIFICATION" ? "NEEDS_VERIFICATION" : "NONE";
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    methodType: row.methodType,
    requiresReference: row.requiresReference,
    recordingMode: row.methodType === "CASH" ? "CASH" : "MANUAL",
    integration,
  };
}

function recordingNote(methodCode: string, methodType: string): string | null {
  if (methodCode === "SHAMCASH" || methodType === "MANUAL") {
    return "Staff-recorded ShamCash payment. Not verified by a payment provider API.";
  }
  return null;
}

async function appliedTotalForCharge(tx: AppDatabase, chargeId: string): Promise<MinorUnits> {
  const rows = await tx
    .select({
      applied: sql<string>`coalesce(sum(${financePaymentAllocations.amountMinor}), 0)::text`,
    })
    .from(financePaymentAllocations)
    .where(eq(financePaymentAllocations.chargeId, chargeId));
  return parseMinorUnits(rows[0]?.applied ?? "0");
}

function serializePayment(row: PaymentRow, extra: {
  chargeId: string;
  sessionId: string;
  paymentMethodCode: string;
  paymentMethodName: string;
  paymentMethodType: string;
}): PaymentJson {
  return {
    id: row.id,
    chargeId: extra.chargeId,
    sessionId: extra.sessionId,
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    status: "COMPLETED",
    paymentMethodCode: extra.paymentMethodCode,
    paymentMethodName: extra.paymentMethodName,
    paymentMethodType: extra.paymentMethodType,
    externalReference: row.externalReference,
    receivedAt: iso(row.receivedAt),
    createdBy: row.createdBy,
    recordingNote: recordingNote(extra.paymentMethodCode, extra.paymentMethodType),
  };
}

async function loadChargeForSession(
  tx: AppDatabase,
  organizationId: string,
  sessionId: string,
): Promise<ChargeRow | null> {
  const rows = await tx
    .select()
    .from(financeCharges)
    .where(
      and(
        eq(financeCharges.organizationId, organizationId),
        eq(financeCharges.sourceModule, GAMING_CHARGE_SOURCE_MODULE),
        eq(financeCharges.sourceType, GAMING_CHARGE_SOURCE_TYPE),
        eq(financeCharges.sourceId, sessionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function checkoutIneligible(
  sessionId: string,
  reason: string,
  methods: PaymentMethodJson[],
): SessionCheckoutView {
  return {
    sessionId,
    eligible: false,
    reason,
    settlementStatus: "INELIGIBLE",
    billTotalMinor: null,
    appliedMinor: null,
    remainingMinor: null,
    currency: null,
    billingFinalizedAt: null,
    chargeId: null,
    customerId: null,
    guest: false,
    guestMustPayInFull: false,
    methods,
    payments: [],
    playingStartedAt: null,
    playingEndedAt: null,
    play: null,
    drinks: [],
  };
}

function settlementFrom(applied: MinorUnits, total: MinorUnits): SettlementStatus {
  if (total === 0n || applied === total) return "PAID";
  if (applied === 0n) return "UNPAID";
  return "PARTIALLY_PAID";
}

function assertFinalizedBill(session: SessionRow): {
  total: MinorUnits;
  currency: string;
  finalizedAt: Date | string;
} {
  if (session.status === "CANCELLED") {
    throw new ConflictError("Cancelled sessions are not payable");
  }
  if (session.status === "ACTIVE" || session.status === "PAUSED" || session.status === "ENDING") {
    throw new ConflictError("Open sessions cannot be checked out");
  }
  if (session.status !== "COMPLETED") {
    throw new ConflictError("Only a completed session can be checked out");
  }
  if (session.billingFinalizedAt == null || session.billingCurrency == null || session.gamingTotalMinor == null) {
    throw new ConflictError("Session billing is not finalized");
  }
  return {
    total: session.gamingTotalMinor,
    currency: session.billingCurrency,
    finalizedAt: session.billingFinalizedAt,
  };
}

async function loadLinkedPosCharges(
  tx: AppDatabase,
  organizationId: string,
  sessionId: string,
): Promise<Array<{ charge: ChargeRow; orderId: string; items: Array<typeof financeChargeItems.$inferSelect> }>> {
  const links = await tx
    .select({
      orderId: gamingSessionOrderLinks.orderId,
      chargeId: posOrders.chargeId,
    })
    .from(gamingSessionOrderLinks)
    .innerJoin(
      posOrders,
      and(
        eq(posOrders.id, gamingSessionOrderLinks.orderId),
        eq(posOrders.organizationId, gamingSessionOrderLinks.organizationId),
      ),
    )
    .where(
      and(
        eq(gamingSessionOrderLinks.organizationId, organizationId),
        eq(gamingSessionOrderLinks.sessionId, sessionId),
      ),
    );

  const result: Array<{
    charge: ChargeRow;
    orderId: string;
    items: Array<typeof financeChargeItems.$inferSelect>;
  }> = [];

  for (const link of links) {
    if (!link.chargeId) continue;
    const charges = await tx
      .select()
      .from(financeCharges)
      .where(
        and(
          eq(financeCharges.id, link.chargeId),
          eq(financeCharges.organizationId, organizationId),
          eq(financeCharges.sourceModule, POS_CHARGE_SOURCE_MODULE),
          eq(financeCharges.sourceType, POS_CHARGE_SOURCE_TYPE),
        ),
      )
      .limit(1);
    const charge = charges[0];
    if (!charge) continue;
    const items = await tx
      .select()
      .from(financeChargeItems)
      .where(
        and(
          eq(financeChargeItems.chargeId, charge.id),
          eq(financeChargeItems.organizationId, organizationId),
        ),
      )
      .orderBy(asc(financeChargeItems.createdAt), asc(financeChargeItems.id));
    result.push({ charge, orderId: link.orderId, items });
  }
  return result;
}

async function listPaymentsForSessionCharges(
  tx: AppDatabase,
  chargeIds: string[],
  sessionId: string,
): Promise<PaymentJson[]> {
  if (chargeIds.length === 0) return [];
  const rows = await tx
    .select({
      payment: financePayments,
      method: financePaymentMethods,
      allocation: financePaymentAllocations,
    })
    .from(financePaymentAllocations)
    .innerJoin(
      financePayments,
      and(
        eq(financePaymentAllocations.paymentId, financePayments.id),
        eq(financePaymentAllocations.organizationId, financePayments.organizationId),
      ),
    )
    .innerJoin(
      financePaymentMethods,
      and(
        eq(financePaymentMethods.id, financePayments.paymentMethodId),
        eq(financePaymentMethods.organizationId, financePayments.organizationId),
      ),
    )
    .where(inArray(financePaymentAllocations.chargeId, chargeIds))
    .orderBy(asc(financePayments.receivedAt));

  const seen = new Set<string>();
  const payments: PaymentJson[] = [];
  for (const row of rows) {
    if (seen.has(row.payment.id)) continue;
    seen.add(row.payment.id);
    payments.push(
      serializePayment(row.payment, {
        chargeId: row.allocation.chargeId,
        sessionId,
        paymentMethodCode: row.method.code,
        paymentMethodName: row.method.name,
        paymentMethodType: row.method.methodType,
      }),
    );
  }
  return payments;
}

async function buildCheckoutView(
  tx: AppDatabase,
  session: SessionRow,
): Promise<SessionCheckoutView> {
  const methods = (await listActivePaymentMethods(tx, session.organizationId)).map(methodJson);
  if (session.status === "CANCELLED") {
    return checkoutIneligible(session.id, "CANCELLED_SESSION", methods);
  }
  if (session.status === "ACTIVE" || session.status === "PAUSED" || session.status === "ENDING") {
    return checkoutIneligible(session.id, "OPEN_SESSION", methods);
  }
  if (session.status !== "COMPLETED") {
    return checkoutIneligible(session.id, "NOT_COMPLETED", methods);
  }
  if (session.billingFinalizedAt == null || session.billingCurrency == null || session.gamingTotalMinor == null) {
    return checkoutIneligible(session.id, "BILLING_NOT_FINALIZED", methods);
  }

  const gamingTotal = session.gamingTotalMinor;
  const gamingCharge = await loadChargeForSession(tx, session.organizationId, session.id);
  const gamingApplied = gamingCharge ? await appliedTotalForCharge(tx, gamingCharge.id) : 0n;
  const gamingRemaining = subtractMinor(gamingTotal, gamingApplied);

  const posBundles = await loadLinkedPosCharges(tx, session.organizationId, session.id);
  const drinks: SessionCheckoutView["drinks"] = [];
  let posTotal = 0n;
  let posApplied = 0n;
  for (const bundle of posBundles) {
    const applied = await appliedTotalForCharge(tx, bundle.charge.id);
    posTotal = addMinor(posTotal, bundle.charge.totalMinor);
    posApplied = addMinor(posApplied, applied);
    const settlements = deriveFifoItemSettlements(
      bundle.items.map((item) => ({
        id: item.id,
        totalMinor: item.totalMinor.toString(),
        descriptionSnapshot: item.descriptionSnapshot,
        sortKey: `${iso(item.createdAt)}:${item.id}`,
      })),
      applied,
    );
    for (const line of settlements) {
      const orderItemId =
        bundle.items.find((item) => item.id === line.id)?.sourceId ?? line.id;
      drinks.push({
        orderId: bundle.orderId,
        orderItemId,
        chargeId: bundle.charge.id,
        chargeItemId: line.id,
        description: line.descriptionSnapshot,
        totalMinor: line.totalMinor,
        paidMinor: line.paidMinor,
        remainingMinor: line.remainingMinor,
        fullyPaid: line.fullyPaid,
      });
    }
  }

  const combinedTotal = addMinor(gamingTotal, posTotal);
  const combinedApplied = addMinor(gamingApplied, posApplied);
  const combinedRemaining = subtractMinor(combinedTotal, combinedApplied);
  const chargeIds = [
    ...(gamingCharge ? [gamingCharge.id] : []),
    ...posBundles.map((row) => row.charge.id),
  ];
  const payments = await listPaymentsForSessionCharges(tx, chargeIds, session.id);
  const guest = session.customerId == null;

  return {
    sessionId: session.id,
    eligible: true,
    reason: null,
    settlementStatus: settlementFrom(combinedApplied, combinedTotal),
    billTotalMinor: combinedTotal.toString(),
    appliedMinor: combinedApplied.toString(),
    remainingMinor: combinedRemaining.toString(),
    currency: session.billingCurrency,
    billingFinalizedAt: iso(session.billingFinalizedAt),
    chargeId: gamingCharge?.id ?? session.chargeId ?? null,
    customerId: session.customerId,
    guest,
    guestMustPayInFull: guest,
    methods,
    payments,
    playingStartedAt: iso(session.startedAt),
    playingEndedAt: session.endedAt ? iso(session.endedAt) : null,
    play: {
      chargeId: gamingCharge?.id ?? null,
      totalMinor: gamingTotal.toString(),
      appliedMinor: gamingApplied.toString(),
      remainingMinor: gamingRemaining.toString(),
    },
    drinks,
  };
}

function paymentRequestHash(input: {
  sessionId: string;
  amountMinor: string;
  currency: string;
  paymentMethodCode: string;
  externalReference: string | null;
  allocations: Array<{ chargeId: string; amountMinor: string }>;
}): string {
  const canonical = JSON.stringify({
    allocations: input.allocations
      .map((row) => ({ chargeId: row.chargeId, amountMinor: row.amountMinor }))
      .sort((a, b) => a.chargeId.localeCompare(b.chargeId) || a.amountMinor.localeCompare(b.amountMinor)),
    amountMinor: input.amountMinor,
    currency: input.currency,
    externalReference: input.externalReference,
    paymentMethodCode: input.paymentMethodCode,
    sessionId: input.sessionId,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function chargeStatusFor(applied: MinorUnits, total: MinorUnits): "OPEN" | "PARTIALLY_PAID" | "PAID" {
  if (total === 0n || applied === total) return "PAID";
  if (applied === 0n) return "OPEN";
  return "PARTIALLY_PAID";
}

async function ensureSessionCharge(
  tx: AppDatabase,
  actor: OrganizationActor,
  session: SessionRow,
  now: Date,
): Promise<ChargeRow> {
  const existing = await loadChargeForSession(tx, actor.organizationId, session.id);
  if (existing) {
    await tx.execute(
      sql`select id from finance_charges where id = ${existing.id} and organization_id = ${actor.organizationId} for update`,
    );
    const locked = await loadChargeForSession(tx, actor.organizationId, session.id);
    if (!locked) throw new ConflictError("Charge disappeared during checkout");
    return locked;
  }

  const bill = assertFinalizedBill(session);
  const chargeId = createId();
  await tx.insert(financeCharges).values({
    id: chargeId,
    organizationId: actor.organizationId,
    branchId: session.branchId,
    customerId: session.customerId,
    sourceModule: GAMING_CHARGE_SOURCE_MODULE,
    sourceType: GAMING_CHARGE_SOURCE_TYPE,
    sourceId: session.id,
    status: bill.total === 0n ? "PAID" : "OPEN",
    currency: bill.currency,
    subtotalMinor: bill.total,
    discountMinor: 0n,
    taxMinor: 0n,
    totalMinor: bill.total,
    issuedAt: now,
    createdBy: actor.userId,
  });
  await tx.insert(financeChargeItems).values({
    id: createId(),
    organizationId: actor.organizationId,
    chargeId,
    itemType: "GAMING_TIME",
    descriptionSnapshot: `Gaming session #${session.sessionNumber}`,
    quantity: "1.000",
    unitAmountMinor: bill.total,
    totalMinor: bill.total,
    sourceType: GAMING_CHARGE_SOURCE_TYPE,
    sourceId: session.id,
    metadata: {
      sessionId: session.id,
      billingFinalizedAt: iso(bill.finalizedAt),
      billingRuleVersion: session.billingRuleVersion,
    },
  });
  await tx
    .update(gamingSessions)
    .set({ chargeId })
    .where(
      and(
        eq(gamingSessions.id, session.id),
        eq(gamingSessions.organizationId, actor.organizationId),
        sql`${gamingSessions.chargeId} is null`,
      ),
    );
  if (session.customerId && bill.total > 0n) {
    await appendCustomerLedgerEntry(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      customerId: session.customerId,
      entryKind: "GAMING",
      direction: "DEBIT",
      amountMinor: bill.total,
      currency: bill.currency,
      description: `Gaming session #${session.sessionNumber}`,
      occurredAt: now,
      sourceModule: "gaming",
      sourceType: "session_charge",
      sourceId: chargeId,
      chargeId,
      createdBy: actor.userId,
    });
  }
  await tx.insert(coreOutboxEvents).values({
    id: createId(),
    organizationId: actor.organizationId,
    branchId: session.branchId,
    eventType: "finance.charge.created",
    aggregateType: "finance_charge",
    aggregateId: chargeId,
    payload: {
      chargeId,
      sessionId: session.id,
      totalMinor: bill.total.toString(),
      currency: bill.currency,
    },
  });
  await recordAudit(tx, {
    organizationId: actor.organizationId,
    branchId: session.branchId,
    actorUserId: actor.userId,
    action: "finance.charge.created",
    entityType: "finance_charge",
    entityId: chargeId,
    after: {
      sessionId: session.id,
      totalMinor: bill.total.toString(),
      currency: bill.currency,
      status: bill.total === 0n ? "PAID" : "OPEN",
    },
    metadata: { sourceModule: GAMING_CHARGE_SOURCE_MODULE, sourceType: GAMING_CHARGE_SOURCE_TYPE },
  });

  const created = await loadChargeForSession(tx, actor.organizationId, session.id);
  if (!created) throw new ConflictError("Charge was not created");
  return created;
}

export async function getSessionCheckout(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
): Promise<SessionCheckoutView> {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await loadOwnSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "VIEW");
    return buildCheckoutView(tx, session);
  });
}

export async function listSessionPayments(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
): Promise<PaymentJson[]> {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
  const checkout = await getSessionCheckout(db, actor, sessionId);
  return checkout.payments;
}

export async function getPayment(
  db: AppDatabase,
  actor: OrganizationActor,
  paymentId: string,
): Promise<PaymentJson> {
  const canReadPayments = actor.permissions.includes(PERMISSIONS.financePaymentsRead);
  const canReadSessions = actor.permissions.includes(PERMISSIONS.gamingSessionsRead);
  if (!canReadPayments && !canReadSessions) {
    assertPermission(actor, PERMISSIONS.financePaymentsRead);
  }
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const rows = await tx
      .select()
      .from(financePayments)
      .where(and(eq(financePayments.id, paymentId), eq(financePayments.organizationId, actor.organizationId)))
      .limit(1);
    const payment = rows[0];
    if (!payment) throw new NotFoundError("Payment not found");
    requireBranchAccess(actor, payment.branchId, "VIEW");

    const allocations = await tx
      .select()
      .from(financePaymentAllocations)
      .where(eq(financePaymentAllocations.paymentId, payment.id))
      .limit(1);
    const allocation = allocations[0];
    if (!allocation) throw new NotFoundError("Payment not found");
    const charges = await tx
      .select()
      .from(financeCharges)
      .where(eq(financeCharges.id, allocation.chargeId))
      .limit(1);
    const charge = charges[0];
    if (!charge) throw new NotFoundError("Payment not found");
    let sessionId = charge.sourceId;
    if (charge.sourceModule === POS_CHARGE_SOURCE_MODULE && charge.sourceType === POS_CHARGE_SOURCE_TYPE) {
      const links = await tx
        .select({ sessionId: gamingSessionOrderLinks.sessionId })
        .from(gamingSessionOrderLinks)
        .where(
          and(
            eq(gamingSessionOrderLinks.organizationId, actor.organizationId),
            eq(gamingSessionOrderLinks.orderId, charge.sourceId),
          ),
        )
        .limit(1);
      if (!links[0]) throw new NotFoundError("Payment not found");
      sessionId = links[0].sessionId;
    } else if (
      charge.sourceModule !== GAMING_CHARGE_SOURCE_MODULE ||
      charge.sourceType !== GAMING_CHARGE_SOURCE_TYPE
    ) {
      throw new NotFoundError("Payment not found");
    }
    const methods = await tx
      .select()
      .from(financePaymentMethods)
      .where(eq(financePaymentMethods.id, payment.paymentMethodId))
      .limit(1);
    const method = methods[0];
    if (!method) throw new NotFoundError("Payment not found");
    return serializePayment(payment, {
      chargeId: charge.id,
      sessionId,
      paymentMethodCode: method.code,
      paymentMethodName: method.name,
      paymentMethodType: method.methodType,
    });
  });
}

export async function recordSessionPayment(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
  input: RecordSessionPaymentInput,
  idempotencyKey: string,
): Promise<{ payment: PaymentJson; checkout: SessionCheckoutView; replayed: boolean }> {
  assertPermission(actor, PERMISSIONS.financePaymentsCreate);
  const key = idempotencyKeySchema.parse(idempotencyKey);
  const parsed = recordSessionPaymentInputSchema.parse({ ...input, idempotencyKey: key });
  const externalReference = parsed.externalReference?.trim() ? parsed.externalReference.trim() : null;

  try {
    return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      const session = await lockSession(tx, actor.organizationId, sessionId);
      requireBranchAccess(actor, session.branchId, "OPERATE");
      const bill = assertFinalizedBill(session);
      if (parsed.currency && parsed.currency !== bill.currency) {
        throw new ValidationError("Payment currency must match the finalized bill", "payment_currency_mismatch");
      }
      const currency = bill.currency;
      const method = await loadActivePaymentMethodByCode(tx, actor.organizationId, parsed.paymentMethodCode);
      if (!method) {
        throw new ValidationError("Unsupported payment method", "unsupported_payment_method");
      }
      if (method.requiresReference && !externalReference) {
        throw new ValidationError("This payment method requires a reference", "payment_reference_required");
      }

      const now = await transactionNow(tx);
      const gamingCharge = await ensureSessionCharge(tx, actor, session, now);
      const posBundles = await loadLinkedPosCharges(tx, actor.organizationId, session.id);
      const sessionChargeIds = new Set<string>([
        gamingCharge.id,
        ...posBundles.map((row) => row.charge.id),
      ]);

      let allocationPlan: Array<{ chargeId: string; amount: MinorUnits }>;
      if (parsed.allocations?.length) {
        allocationPlan = parsed.allocations.map((row) => ({
          chargeId: row.chargeId,
          amount: assertInt64Minor(parseMinorUnits(row.amountMinor)),
        }));
      } else {
        const amount = assertInt64Minor(parseMinorUnits(parsed.amountMinor ?? "0"));
        if (amount <= 0n) {
          throw new ValidationError("Payment amount must be greater than zero", "payment_amount_not_positive");
        }
        allocationPlan = [{ chargeId: gamingCharge.id, amount }];
      }

      const seenCharge = new Set<string>();
      let paymentAmount = 0n;
      for (const row of allocationPlan) {
        if (row.amount <= 0n) {
          throw new ValidationError("Payment amount must be greater than zero", "payment_amount_not_positive");
        }
        if (!sessionChargeIds.has(row.chargeId)) {
          throw new ValidationError("Allocation charge does not belong to this session", "allocation_charge_mismatch");
        }
        if (seenCharge.has(row.chargeId)) {
          throw new ValidationError("Duplicate allocation charge", "duplicate_allocation_charge");
        }
        seenCharge.add(row.chargeId);
        paymentAmount = addMinor(paymentAmount, row.amount);
      }

      const hash = paymentRequestHash({
        sessionId,
        amountMinor: paymentAmount.toString(),
        currency,
        paymentMethodCode: method.code,
        externalReference,
        allocations: allocationPlan.map((row) => ({
          chargeId: row.chargeId,
          amountMinor: row.amount.toString(),
        })),
      });
      const replay = await claimIdempotencyKey(tx, actor.organizationId, key, hash, now);
      if (replay) {
        return { ...replay, replayed: true };
      }

      let combinedRemaining = 0n;
      const remainingByCharge = new Map<string, MinorUnits>();
      for (const chargeId of sessionChargeIds) {
        const charges = await tx
          .select()
          .from(financeCharges)
          .where(and(eq(financeCharges.id, chargeId), eq(financeCharges.organizationId, actor.organizationId)))
          .limit(1);
        const charge = charges[0];
        if (!charge) throw new ConflictError("Charge disappeared during checkout");
        if (charge.currency !== currency) {
          throw new ValidationError("Payment currency must match the finalized bill", "payment_currency_mismatch");
        }
        await tx.execute(
          sql`select id from finance_charges where id = ${charge.id} and organization_id = ${actor.organizationId} for update`,
        );
        const applied = await appliedTotalForCharge(tx, charge.id);
        const remaining = subtractMinor(charge.totalMinor, applied);
        remainingByCharge.set(charge.id, remaining);
        combinedRemaining = addMinor(combinedRemaining, remaining);
      }

      if (combinedRemaining === 0n) {
        throw new ConflictError("Bill is already settled", "bill_already_settled");
      }

      for (const row of allocationPlan) {
        const remaining = remainingByCharge.get(row.chargeId) ?? 0n;
        if (row.amount > remaining) {
          throw new ConflictError("Payment exceeds remaining amount due", "payment_exceeds_remaining");
        }
      }

      const guest = session.customerId == null;
      if (guest && paymentAmount !== combinedRemaining) {
        throw new ConflictError("Guest sessions must be paid in full", "guest_must_pay_in_full");
      }

      const paymentId = createId();
      const inserted = await tx
        .insert(financePayments)
        .values({
          id: paymentId,
          organizationId: actor.organizationId,
          branchId: session.branchId,
          customerId: session.customerId,
          paymentMethodId: method.id,
          status: "COMPLETED",
          currency,
          amountMinor: paymentAmount,
          externalReference,
          receivedAt: now,
          createdBy: actor.userId,
        })
        .returning();
      const paymentRow = inserted[0];
      if (!paymentRow) throw new ConflictError("Payment was not recorded");

      for (const row of allocationPlan) {
        await tx.insert(financePaymentAllocations).values({
          id: createId(),
          organizationId: actor.organizationId,
          paymentId,
          chargeId: row.chargeId,
          amountMinor: row.amount,
        });
        const chargeRows = await tx
          .select()
          .from(financeCharges)
          .where(and(eq(financeCharges.id, row.chargeId), eq(financeCharges.organizationId, actor.organizationId)))
          .limit(1);
        const charge = chargeRows[0];
        if (!charge) throw new ConflictError("Charge disappeared during checkout");
        const applied = await appliedTotalForCharge(tx, charge.id);
        const nextStatus = chargeStatusFor(applied, charge.totalMinor);
        if (nextStatus !== charge.status) {
          await tx
            .update(financeCharges)
            .set({ status: nextStatus })
            .where(and(eq(financeCharges.id, charge.id), eq(financeCharges.organizationId, actor.organizationId)));
        }
        if (nextStatus === "PAID") {
          await tx.insert(coreOutboxEvents).values({
            id: createId(),
            organizationId: actor.organizationId,
            branchId: session.branchId,
            eventType: "finance.charge.settled",
            aggregateType: "finance_charge",
            aggregateId: charge.id,
            payload: {
              chargeId: charge.id,
              sessionId: session.id,
              paymentId,
              totalMinor: charge.totalMinor.toString(),
              currency,
            },
          });
        }
      }

      const payment = serializePayment(paymentRow, {
        chargeId: allocationPlan[0]!.chargeId,
        sessionId: session.id,
        paymentMethodCode: method.code,
        paymentMethodName: method.name,
        paymentMethodType: method.methodType,
      });

      await tx.insert(coreOutboxEvents).values({
        id: createId(),
        organizationId: actor.organizationId,
        branchId: session.branchId,
        eventType: "finance.payment.completed",
        aggregateType: "finance_payment",
        aggregateId: paymentId,
        payload: {
          paymentId,
          sessionId: session.id,
          amountMinor: paymentAmount.toString(),
          currency,
          paymentMethodCode: method.code,
          externalReference,
          allocations: allocationPlan.map((row) => ({
            chargeId: row.chargeId,
            amountMinor: row.amount.toString(),
          })),
        },
      });

      if (session.customerId) {
        await appendCustomerLedgerEntry(tx, {
          organizationId: actor.organizationId,
          branchId: session.branchId,
          customerId: session.customerId,
          entryKind: "PAYMENT",
          direction: "CREDIT",
          amountMinor: paymentAmount,
          currency,
          description: "Payment",
          occurredAt: now,
          sourceModule: "finance",
          sourceType: "payment",
          sourceId: paymentId,
          paymentId,
          createdBy: actor.userId,
        });
      }
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        branchId: session.branchId,
        actorUserId: actor.userId,
        action: "finance.payment.completed",
        entityType: "finance_payment",
        entityId: paymentId,
        after: {
          amountMinor: paymentAmount.toString(),
          currency,
          paymentMethodCode: method.code,
          status: "COMPLETED",
        },
        metadata: {
          sessionId: session.id,
          paymentId,
          amountMinor: paymentAmount.toString(),
          currency,
          paymentMethodCode: method.code,
          externalReference,
          allocations: allocationPlan.map((row) => ({
            chargeId: row.chargeId,
            amountMinor: row.amount.toString(),
          })),
        },
      });

      const checkout = await buildCheckoutView(tx, await loadOwnSession(tx, actor.organizationId, session.id));
      await storeIdempotencyResponse(tx, actor.organizationId, key, {
        payment,
        checkout,
        replayed: false,
      });
      return { payment, checkout, replayed: false };
    });
  } catch (error) {
    if (isCheckViolation(error)) {
      throw new ConflictError("Payment exceeds remaining amount due", "payment_exceeds_remaining");
    }
    throw error;
  }
}

async function claimIdempotencyKey(
  tx: AppDatabase,
  organizationId: string,
  key: string,
  hash: string,
  now: Date,
): Promise<{ payment: PaymentJson; checkout: SessionCheckoutView; replayed: boolean } | null> {
  const inserted = await tx
    .insert(coreIdempotencyKeys)
    .values({
      id: createId(),
      organizationId,
      scope: PAYMENT_IDEMPOTENCY_SCOPE,
      idempotencyKey: key,
      requestHash: hash,
      responseStatus: null,
      responseBody: null,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return null;

  const rows = await tx
    .select()
    .from(coreIdempotencyKeys)
    .where(
      and(
        eq(coreIdempotencyKeys.organizationId, organizationId),
        eq(coreIdempotencyKeys.scope, PAYMENT_IDEMPOTENCY_SCOPE),
        eq(coreIdempotencyKeys.idempotencyKey, key),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    throw new ConflictError("Idempotency key conflict");
  }
  if (existing.requestHash && existing.requestHash !== hash) {
    throw new ConflictError("Idempotency key reused with a different payment");
  }
  if (!existing.responseBody) {
    throw new ConflictError("A payment with this idempotency key is already in progress");
  }
  return existing.responseBody as {
    payment: PaymentJson;
    checkout: SessionCheckoutView;
    replayed: boolean;
  };
}

async function storeIdempotencyResponse(
  tx: AppDatabase,
  organizationId: string,
  key: string,
  body: { payment: PaymentJson; checkout: SessionCheckoutView; replayed: boolean },
): Promise<void> {
  await tx
    .update(coreIdempotencyKeys)
    .set({
      responseStatus: 200,
      responseBody: body,
    })
    .where(
      and(
        eq(coreIdempotencyKeys.organizationId, organizationId),
        eq(coreIdempotencyKeys.scope, PAYMENT_IDEMPOTENCY_SCOPE),
        eq(coreIdempotencyKeys.idempotencyKey, key),
      ),
    );
}
