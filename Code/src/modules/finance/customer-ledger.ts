import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { createId } from "@/core/ids";
import { addMinor, assertInt64Minor, parseMinorUnits, subtractMinor, type MinorUnits } from "@/core/money";
import { assertBranchAccess, assertPermission } from "@/core/tenancy";
import {
  coreBranches,
  coreIdempotencyKeys,
  coreOrganizations,
  financeChargeItems,
  financeCharges,
  financeCustomerLedgerEntries,
  financePaymentAllocations,
  financePayments,
  coreCustomers,
} from "@/db/schema";
import { withPortalToken, withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { ensureDefaultPaymentMethods, loadActivePaymentMethodByCode } from "./methods";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEDGER_IDEMPOTENCY_SCOPE = "finance.customer_ledger";
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCOUNT_PAYMENT_METHOD = "CASH";

export const LEDGER_ENTRY_KINDS = ["OPENING_DEBT", "OPENING_CREDIT", "PAYMENT", "GAMING", "DRINK"] as const;
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];
export type LedgerDirection = "DEBIT" | "CREDIT";
export type BalancePosition = "DEBTOR" | "CREDITOR" | "SETTLED";

export type LedgerLine = {
  id: string;
  occurredAt: string;
  entryKind: LedgerEntryKind;
  direction: LedgerDirection;
  description: string;
  amountMinor: string;
  balanceMinor: string;
  currency: string;
};

export type CustomerStatement = {
  currency: string;
  balanceMinor: string;
  position: BalancePosition;
  lines: LedgerLine[];
};

export type PortalStatement = CustomerStatement & {
  displayName: string;
};

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const postCustomerLedgerInputSchema = z.object({
  branchId: z.string().regex(UUID_PATTERN, "Invalid branch id"),
  kind: z.enum(["PAYMENT", "DRINK"]),
  amountMinor: z.string().trim().regex(/^[1-9]\d*$/, "amountMinor must be a positive integer string"),
  description: z.string().trim().min(1).max(200),
  idempotencyKey: idempotencyKeySchema,
});

export type PostCustomerLedgerInput = z.infer<typeof postCustomerLedgerInputSchema>;

export type LedgerEntryDraft = {
  organizationId: string;
  branchId: string;
  customerId: string;
  entryKind: LedgerEntryKind;
  direction: LedgerDirection;
  amountMinor: MinorUnits;
  currency: string;
  description: string;
  occurredAt: Date;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  chargeId?: string | null;
  paymentId?: string | null;
  createdBy: string | null;
};

export function newPortalToken(): string {
  return randomUUID();
}

export function balancePosition(balance: MinorUnits): BalancePosition {
  if (balance > 0n) return "DEBTOR";
  if (balance < 0n) return "CREDITOR";
  return "SETTLED";
}

export async function appendCustomerLedgerEntry(tx: AppDatabase, draft: LedgerEntryDraft): Promise<void> {
  if (draft.amountMinor <= 0n) return;
  await tx
    .insert(financeCustomerLedgerEntries)
    .values({
      id: createId(),
      organizationId: draft.organizationId,
      branchId: draft.branchId,
      customerId: draft.customerId,
      entryKind: draft.entryKind,
      direction: draft.direction,
      amountMinor: draft.amountMinor,
      currency: draft.currency,
      description: draft.description.trim(),
      occurredAt: draft.occurredAt,
      sourceModule: draft.sourceModule,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId,
      chargeId: draft.chargeId ?? null,
      paymentId: draft.paymentId ?? null,
      createdBy: draft.createdBy,
    })
    .onConflictDoNothing({
      target: [
        financeCustomerLedgerEntries.organizationId,
        financeCustomerLedgerEntries.sourceModule,
        financeCustomerLedgerEntries.sourceType,
        financeCustomerLedgerEntries.sourceId,
      ],
    });
}

export async function organizationCurrency(db: AppDatabase, actor: OrganizationActor): Promise<string> {
  assertPermission(actor, PERMISSIONS.customersRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    loadOrganizationCurrency(tx, actor.organizationId),
  );
}

export async function getCustomerStatement(
  db: AppDatabase,
  actor: OrganizationActor,
  customerId: string,
): Promise<CustomerStatement> {
  assertPermission(actor, PERMISSIONS.customersRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    await requireCustomer(tx, actor.organizationId, customerId);
    const currency = await loadOrganizationCurrency(tx, actor.organizationId);
    return buildStatement(tx, actor.organizationId, customerId, currency);
  });
}

export async function getPortalStatement(db: AppDatabase, portalToken: string): Promise<PortalStatement | null> {
  if (!UUID_PATTERN.test(portalToken)) return null;
  return withPortalToken(db, portalToken, async (tx) => {
    const rows = await tx
      .select({
        id: coreCustomers.id,
        organizationId: coreCustomers.organizationId,
        displayName: coreCustomers.displayName,
      })
      .from(coreCustomers)
      .where(eq(coreCustomers.portalToken, portalToken))
      .limit(1);
    const customer = rows[0];
    if (!customer) return null;
    const currency = await loadOrganizationCurrency(tx, customer.organizationId);
    const statement = await buildStatement(tx, customer.organizationId, customer.id, currency);
    return { displayName: customer.displayName, ...statement };
  });
}

export async function postOpeningBalance(
  tx: AppDatabase,
  actor: OrganizationActor,
  input: {
    customerId: string;
    branchId: string;
    side: "DEBTOR" | "CREDITOR";
    amountMinor: MinorUnits;
    occurredAt: Date;
  },
): Promise<void> {
  if (input.amountMinor <= 0n) return;
  assertInt64Minor(input.amountMinor);
  const currency = await loadOrganizationCurrency(tx, actor.organizationId);
  if (input.side === "DEBTOR") {
    const chargeId = createId();
    await tx.insert(financeCharges).values({
      id: chargeId,
      organizationId: actor.organizationId,
      branchId: input.branchId,
      customerId: input.customerId,
      sourceModule: "manual_adjustment",
      sourceType: "opening_debt",
      sourceId: input.customerId,
      status: "OPEN",
      currency,
      subtotalMinor: input.amountMinor,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: input.amountMinor,
      issuedAt: input.occurredAt,
      createdBy: actor.userId,
    });
    await tx.insert(financeChargeItems).values({
      id: createId(),
      organizationId: actor.organizationId,
      chargeId,
      itemType: "OPENING_DEBT",
      descriptionSnapshot: "Opening balance",
      quantity: "1.000",
      unitAmountMinor: input.amountMinor,
      totalMinor: input.amountMinor,
      sourceType: "opening_debt",
      sourceId: input.customerId,
    });
    await appendCustomerLedgerEntry(tx, {
      organizationId: actor.organizationId,
      branchId: input.branchId,
      customerId: input.customerId,
      entryKind: "OPENING_DEBT",
      direction: "DEBIT",
      amountMinor: input.amountMinor,
      currency,
      description: "Opening balance",
      occurredAt: input.occurredAt,
      sourceModule: "customers",
      sourceType: "opening_debt",
      sourceId: input.customerId,
      chargeId,
      createdBy: actor.userId,
    });
    return;
  }

  await appendCustomerLedgerEntry(tx, {
    organizationId: actor.organizationId,
    branchId: input.branchId,
    customerId: input.customerId,
    entryKind: "OPENING_CREDIT",
    direction: "CREDIT",
    amountMinor: input.amountMinor,
    currency,
    description: "Opening credit",
    occurredAt: input.occurredAt,
    sourceModule: "customers",
    sourceType: "opening_credit",
    sourceId: input.customerId,
    createdBy: actor.userId,
  });
}

export async function postCustomerLedgerEntry(
  db: AppDatabase,
  actor: OrganizationActor,
  customerId: string,
  input: PostCustomerLedgerInput,
): Promise<{ statement: CustomerStatement; replayed: boolean }> {
  if (input.kind === "PAYMENT") {
    assertPermission(actor, PERMISSIONS.financePaymentsCreate);
  } else {
    assertPermission(actor, PERMISSIONS.customersManage);
  }
  const parsed = postCustomerLedgerInputSchema.parse(input);
  const amount = assertInt64Minor(parseMinorUnits(parsed.amountMinor));
  assertBranchAccess(actor, parsed.branchId, "OPERATE");

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const customer = await requireCustomer(tx, actor.organizationId, customerId);
    if (customer.status !== "ACTIVE") {
      throw new ConflictError("Only an active customer can receive a new ledger entry");
    }
    await requireActiveBranch(tx, actor.organizationId, parsed.branchId);
    const currency = await loadOrganizationCurrency(tx, actor.organizationId);
    const now = await transactionNow(tx);
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          customerId,
          branchId: parsed.branchId,
          kind: parsed.kind,
          amountMinor: amount.toString(),
          description: parsed.description,
        }),
      )
      .digest("hex");
    const replay = await claimIdempotency(tx, actor.organizationId, parsed.idempotencyKey, hash, now);
    if (replay) {
      return { statement: await buildStatement(tx, actor.organizationId, customerId, currency), replayed: true };
    }

    if (parsed.kind === "DRINK") {
      await postDrink(tx, actor, {
        customerId,
        branchId: parsed.branchId,
        amount,
        currency,
        description: parsed.description,
        occurredAt: now,
      });
    } else {
      await postAccountPayment(tx, actor, {
        customerId,
        branchId: parsed.branchId,
        amount,
        currency,
        description: parsed.description,
        occurredAt: now,
      });
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: parsed.branchId,
      actorUserId: actor.userId,
      action: parsed.kind === "DRINK" ? "finance.customer_ledger.drink" : "finance.customer_ledger.payment",
      entityType: "customer",
      entityId: customerId,
      after: {
        kind: parsed.kind,
        amountMinor: amount.toString(),
        currency,
        description: parsed.description,
      },
    });

    const statement = await buildStatement(tx, actor.organizationId, customerId, currency);
    await storeIdempotency(tx, actor.organizationId, parsed.idempotencyKey);
    return { statement, replayed: false };
  });
}

async function postDrink(
  tx: AppDatabase,
  actor: OrganizationActor,
  input: {
    customerId: string;
    branchId: string;
    amount: MinorUnits;
    currency: string;
    description: string;
    occurredAt: Date;
  },
): Promise<void> {
  const chargeId = createId();
  await tx.insert(financeCharges).values({
    id: chargeId,
    organizationId: actor.organizationId,
    branchId: input.branchId,
    customerId: input.customerId,
    sourceModule: "pos",
    sourceType: "drink",
    sourceId: chargeId,
    status: "OPEN",
    currency: input.currency,
    subtotalMinor: input.amount,
    discountMinor: 0n,
    taxMinor: 0n,
    totalMinor: input.amount,
    issuedAt: input.occurredAt,
    createdBy: actor.userId,
  });
  await tx.insert(financeChargeItems).values({
    id: createId(),
    organizationId: actor.organizationId,
    chargeId,
    itemType: "DRINK",
    descriptionSnapshot: input.description,
    quantity: "1.000",
    unitAmountMinor: input.amount,
    totalMinor: input.amount,
    sourceType: "drink",
    sourceId: chargeId,
  });
  await appendCustomerLedgerEntry(tx, {
    organizationId: actor.organizationId,
    branchId: input.branchId,
    customerId: input.customerId,
    entryKind: "DRINK",
    direction: "DEBIT",
    amountMinor: input.amount,
    currency: input.currency,
    description: input.description,
    occurredAt: input.occurredAt,
    sourceModule: "pos",
    sourceType: "drink",
    sourceId: chargeId,
    chargeId,
    createdBy: actor.userId,
  });
}

async function postAccountPayment(
  tx: AppDatabase,
  actor: OrganizationActor,
  input: {
    customerId: string;
    branchId: string;
    amount: MinorUnits;
    currency: string;
    description: string;
    occurredAt: Date;
  },
): Promise<void> {
  await ensureDefaultPaymentMethods(tx, actor.organizationId);
  const method = await loadActivePaymentMethodByCode(tx, actor.organizationId, ACCOUNT_PAYMENT_METHOD);
  if (!method) throw new ValidationError("Cash payment method is not available");

  const paymentId = createId();
  await tx.insert(financePayments).values({
    id: paymentId,
    organizationId: actor.organizationId,
    branchId: input.branchId,
    customerId: input.customerId,
    paymentMethodId: method.id,
    status: "COMPLETED",
    currency: input.currency,
    amountMinor: input.amount,
    externalReference: null,
    receivedAt: input.occurredAt,
    createdBy: actor.userId,
  });

  let remaining = input.amount;
  const openCharges = await tx
    .select()
    .from(financeCharges)
    .where(
      and(
        eq(financeCharges.organizationId, actor.organizationId),
        eq(financeCharges.customerId, input.customerId),
        eq(financeCharges.branchId, input.branchId),
        sql`${financeCharges.status} IN ('OPEN', 'PARTIALLY_PAID')`,
      ),
    )
    .orderBy(asc(financeCharges.issuedAt));

  for (const charge of openCharges) {
    if (remaining <= 0n) break;
    await tx.execute(
      sql`select id from finance_charges where id = ${charge.id} and organization_id = ${actor.organizationId} for update`,
    );
    const applied = await appliedTotal(tx, actor.organizationId, charge.id);
    const due = subtractMinor(charge.totalMinor, applied);
    if (due <= 0n) continue;
    const slice = remaining < due ? remaining : due;
    await tx.insert(financePaymentAllocations).values({
      id: createId(),
      organizationId: actor.organizationId,
      paymentId,
      chargeId: charge.id,
      amountMinor: slice,
    });
    const nextApplied = addMinor(applied, slice);
    const nextStatus = nextApplied >= charge.totalMinor ? "PAID" : "PARTIALLY_PAID";
    if (nextStatus !== charge.status) {
      await tx
        .update(financeCharges)
        .set({ status: nextStatus })
        .where(and(eq(financeCharges.id, charge.id), eq(financeCharges.organizationId, actor.organizationId)));
    }
    remaining = subtractMinor(remaining, slice);
  }

  await appendCustomerLedgerEntry(tx, {
    organizationId: actor.organizationId,
    branchId: input.branchId,
    customerId: input.customerId,
    entryKind: "PAYMENT",
    direction: "CREDIT",
    amountMinor: input.amount,
    currency: input.currency,
    description: input.description,
    occurredAt: input.occurredAt,
    sourceModule: "finance",
    sourceType: "payment",
    sourceId: paymentId,
    paymentId,
    createdBy: actor.userId,
  });
}

async function buildStatement(
  tx: AppDatabase,
  organizationId: string,
  customerId: string,
  currency: string,
): Promise<CustomerStatement> {
  const rows = await tx
    .select()
    .from(financeCustomerLedgerEntries)
    .where(
      and(
        eq(financeCustomerLedgerEntries.organizationId, organizationId),
        eq(financeCustomerLedgerEntries.customerId, customerId),
      ),
    )
    .orderBy(asc(financeCustomerLedgerEntries.occurredAt), asc(financeCustomerLedgerEntries.id));

  let running = 0n;
  const lines: LedgerLine[] = [];
  for (const row of rows) {
    if (row.currency.trim().toUpperCase() !== currency.trim().toUpperCase()) {
      throw new ConflictError("Customer ledger contains a different currency");
    }
    const amount = row.amountMinor;
    running = row.direction === "DEBIT" ? addMinor(running, amount) : subtractMinor(running, amount);
    lines.push({
      id: row.id,
      occurredAt: iso(row.occurredAt),
      entryKind: row.entryKind as LedgerEntryKind,
      direction: row.direction as LedgerDirection,
      description: row.description,
      amountMinor: amount.toString(),
      balanceMinor: running.toString(),
      currency: row.currency,
    });
  }
  return {
    currency,
    balanceMinor: running.toString(),
    position: balancePosition(running),
    lines,
  };
}

async function appliedTotal(tx: AppDatabase, organizationId: string, chargeId: string): Promise<MinorUnits> {
  const rows = await tx
    .select({
      total: sql<string>`coalesce(sum(${financePaymentAllocations.amountMinor}), 0)::text`,
    })
    .from(financePaymentAllocations)
    .where(
      and(
        eq(financePaymentAllocations.organizationId, organizationId),
        eq(financePaymentAllocations.chargeId, chargeId),
      ),
    );
  return parseMinorUnits(rows[0]?.total ?? "0");
}

async function requireCustomer(tx: AppDatabase, organizationId: string, customerId: string) {
  const rows = await tx
    .select({ id: coreCustomers.id, status: coreCustomers.status })
    .from(coreCustomers)
    .where(and(eq(coreCustomers.id, customerId), eq(coreCustomers.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Customer not found");
  return row;
}

async function requireActiveBranch(tx: AppDatabase, organizationId: string, branchId: string): Promise<void> {
  const rows = await tx
    .select({ id: coreBranches.id, status: coreBranches.status })
    .from(coreBranches)
    .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, organizationId)))
    .limit(1);
  const branch = rows[0];
  if (!branch) throw new NotFoundError("Branch not found in this organization");
  if (branch.status === "ARCHIVED") throw new ConflictError("Branch is archived");
}

async function loadOrganizationCurrency(tx: AppDatabase, organizationId: string): Promise<string> {
  const rows = await tx
    .select({ defaultCurrency: coreOrganizations.defaultCurrency })
    .from(coreOrganizations)
    .where(eq(coreOrganizations.id, organizationId))
    .limit(1);
  const currency = rows[0]?.defaultCurrency;
  if (!currency) throw new NotFoundError("Organization not found");
  return currency;
}

async function transactionNow(tx: AppDatabase): Promise<Date> {
  const rows = await tx.select({ now: sql<Date>`now()` }).from(coreOrganizations).limit(1);
  const value = rows[0]?.now;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

async function claimIdempotency(
  tx: AppDatabase,
  organizationId: string,
  key: string,
  hash: string,
  now: Date,
): Promise<boolean> {
  const inserted = await tx
    .insert(coreIdempotencyKeys)
    .values({
      id: createId(),
      organizationId,
      scope: LEDGER_IDEMPOTENCY_SCOPE,
      idempotencyKey: key,
      requestHash: hash,
      responseStatus: null,
      responseBody: null,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return false;
  const rows = await tx
    .select()
    .from(coreIdempotencyKeys)
    .where(
      and(
        eq(coreIdempotencyKeys.organizationId, organizationId),
        eq(coreIdempotencyKeys.scope, LEDGER_IDEMPOTENCY_SCOPE),
        eq(coreIdempotencyKeys.idempotencyKey, key),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing?.responseBody) throw new ConflictError("Idempotency key is already in progress");
  if (existing.requestHash && existing.requestHash !== hash) {
    throw new ConflictError("Idempotency key was reused with a different request");
  }
  return true;
}

async function storeIdempotency(tx: AppDatabase, organizationId: string, key: string): Promise<void> {
  await tx
    .update(coreIdempotencyKeys)
    .set({ responseStatus: 201, responseBody: { ok: true } })
    .where(
      and(
        eq(coreIdempotencyKeys.organizationId, organizationId),
        eq(coreIdempotencyKeys.scope, LEDGER_IDEMPOTENCY_SCOPE),
        eq(coreIdempotencyKeys.idempotencyKey, key),
      ),
    );
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
