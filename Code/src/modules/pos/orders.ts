import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { allocateInternalCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { assertInt64Minor, multiplyMinor, type MinorUnits } from "@/core/money";
import { assertPermission } from "@/core/tenancy";
import {
  catalogProducts,
  coreBranches,
  coreOutboxEvents,
  financeChargeItems,
  financeCharges,
  gamingSessionOrderLinks,
  gamingSessions,
  posOrderItems,
  posOrders,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { resolveProductPrice } from "@/modules/catalog";
import { POS_CHARGE_SOURCE_MODULE, POS_CHARGE_SOURCE_TYPE } from "@/modules/finance/checkout";
import { appendCustomerLedgerEntry } from "@/modules/finance/customer-ledger";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { requireBranchAccess } from "@/modules/gaming/access";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const addSessionDrinkInputSchema = z.object({
  productId: z.string().regex(UUID_PATTERN, "Invalid product id"),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, "quantity must be a positive decimal")
    .default("1"),
});

export type AddSessionDrinkInput = z.infer<typeof addSessionDrinkInputSchema>;

export type SessionDrinkSale = {
  orderId: string;
  orderItemId: string;
  chargeId: string;
  chargeItemId: string;
  sessionId: string;
  description: string;
  quantity: string;
  unitAmountMinor: string;
  totalMinor: string;
  currency: string;
};

async function transactionNow(tx: AppDatabase): Promise<Date> {
  const rows = await tx.select({ now: sql<Date>`now()` }).from(coreBranches).limit(1);
  const value = rows[0]?.now;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

function parseQuantity(raw: string): { display: string; units: MinorUnits } {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError("quantity must be greater than zero");
  }
  // Money multiply uses integer quantity only for MVP drinks (1, 2, …).
  if (!/^\d+$/.test(raw.trim())) {
    throw new ValidationError("quantity must be a whole number in this milestone");
  }
  const units = BigInt(raw.trim());
  if (units <= 0n) throw new ValidationError("quantity must be greater than zero");
  return { display: `${units}.000`, units };
}

/**
 * One completed POS order per drink add, linked to the session, with a POS charge.
 * Atomic: order + item + charge + items + link + outbox (+ ledger debit when customer).
 */
export async function addDrinkToSession(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
  input: AddSessionDrinkInput,
): Promise<SessionDrinkSale> {
  assertPermission(actor, PERMISSIONS.posOrdersCreate);
  const parsed = addSessionDrinkInputSchema.parse(input);
  const qty = parseQuantity(parsed.quantity);

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    await tx.execute(
      sql`select id from gaming_sessions where id = ${sessionId} and organization_id = ${actor.organizationId} for update`,
    );
    const sessions = await tx
      .select()
      .from(gamingSessions)
      .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, actor.organizationId)))
      .limit(1);
    const session = sessions[0];
    if (!session) throw new NotFoundError("Session not found");
    requireBranchAccess(actor, session.branchId, "OPERATE");
    if (session.status !== "ACTIVE" && session.status !== "PAUSED") {
      throw new ConflictError("Drinks can only be added to an active or paused session", "session_not_open");
    }

    const products = await tx
      .select()
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.id, parsed.productId),
          eq(catalogProducts.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    const product = products[0];
    if (!product) throw new NotFoundError("Product not found");
    if (product.status !== "ACTIVE") {
      throw new ConflictError("Product is not active", "product_inactive");
    }

    const price = await resolveProductPrice(tx, {
      organizationId: actor.organizationId,
      productId: product.id,
      branchId: session.branchId,
    });
    const unit = assertInt64Minor(price.amountMinor);
    const lineTotal = multiplyMinor(unit, qty.units);
    const now = await transactionNow(tx);

    const orderId = createId();
    const orderItemId = createId();
    const chargeId = createId();
    const chargeItemId = createId();
    const orderNumber = allocateInternalCode("O-");

    await tx.insert(posOrders).values({
      id: orderId,
      organizationId: actor.organizationId,
      branchId: session.branchId,
      customerId: session.customerId,
      orderNumber,
      status: "OPEN",
      subtotalMinor: lineTotal,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: lineTotal,
      openedBy: actor.userId,
      openedAt: now,
    });

    await tx.insert(posOrderItems).values({
      id: orderItemId,
      organizationId: actor.organizationId,
      orderId,
      productId: product.id,
      descriptionSnapshot: product.name,
      quantity: qty.display,
      unitAmountMinor: unit,
      totalMinor: lineTotal,
    });

    await tx.insert(financeCharges).values({
      id: chargeId,
      organizationId: actor.organizationId,
      branchId: session.branchId,
      customerId: session.customerId,
      sourceModule: POS_CHARGE_SOURCE_MODULE,
      sourceType: POS_CHARGE_SOURCE_TYPE,
      sourceId: orderId,
      status: lineTotal === 0n ? "PAID" : "OPEN",
      currency: price.currency,
      subtotalMinor: lineTotal,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: lineTotal,
      issuedAt: now,
      createdBy: actor.userId,
    });

    await tx.insert(financeChargeItems).values({
      id: chargeItemId,
      organizationId: actor.organizationId,
      chargeId,
      itemType: "POS_ITEM",
      descriptionSnapshot: product.name,
      quantity: qty.display,
      unitAmountMinor: unit,
      totalMinor: lineTotal,
      sourceType: "pos_order_item",
      sourceId: orderItemId,
      metadata: {
        productId: product.id,
        productCode: product.code,
        priceId: price.priceId,
        priceScope: price.scope,
      },
    });

    await tx
      .update(posOrders)
      .set({
        status: "COMPLETED",
        completedAt: now,
        chargeId,
      })
      .where(and(eq(posOrders.id, orderId), eq(posOrders.organizationId, actor.organizationId)));

    await tx.insert(gamingSessionOrderLinks).values({
      organizationId: actor.organizationId,
      sessionId: session.id,
      orderId,
    });

    await tx.insert(coreOutboxEvents).values({
      id: createId(),
      organizationId: actor.organizationId,
      branchId: session.branchId,
      eventType: "pos.order.completed",
      aggregateType: "pos_order",
      aggregateId: orderId,
      payload: {
        orderId,
        sessionId: session.id,
        chargeId,
        totalMinor: lineTotal.toString(),
        currency: price.currency,
        productId: product.id,
      },
    });

    if (session.customerId) {
      await appendCustomerLedgerEntry(tx, {
        organizationId: actor.organizationId,
        branchId: session.branchId,
        customerId: session.customerId,
        entryKind: "DRINK",
        direction: "DEBIT",
        amountMinor: lineTotal,
        currency: price.currency,
        description: product.name,
        occurredAt: now,
        sourceModule: "pos",
        sourceType: "order",
        sourceId: orderId,
        chargeId,
        createdBy: actor.userId,
      });
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      actorUserId: actor.userId,
      action: "pos.order.completed",
      entityType: "pos_order",
      entityId: orderId,
      after: {
        sessionId: session.id,
        chargeId,
        productId: product.id,
        totalMinor: lineTotal.toString(),
        currency: price.currency,
      },
    });

    return {
      orderId,
      orderItemId,
      chargeId,
      chargeItemId,
      sessionId: session.id,
      description: product.name,
      quantity: qty.display,
      unitAmountMinor: unit.toString(),
      totalMinor: lineTotal.toString(),
      currency: price.currency,
    };
  });
}
