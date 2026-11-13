import { createHash } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { createId } from "@/core/ids";
import { assertInt64Minor, parseMinorUnits } from "@/core/money";
import { assertBranchAccess, assertPermission } from "@/core/tenancy";
import {
  coreBranches,
  coreIdempotencyKeys,
  coreOrganizations,
  coreOutboxEvents,
  financeExpenseCategories,
  financeExpenses,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { idempotencyKeySchema } from "@/modules/finance/checkout";
import { ensureDefaultPaymentMethods, loadActivePaymentMethodByCode } from "@/modules/finance/methods";

export const EXPENSE_IDEMPOTENCY_SCOPE = "finance.expenses";
export const DEFAULT_EXPENSE_CATEGORY_CODE = "PURCHASE";
export const DEFAULT_EXPENSE_PAYMENT_METHOD_CODE = "CASH";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const recordExpenseInputSchema = z.object({
  branchId: z.string().regex(UUID_PATTERN, "Invalid branch id"),
  amountMinor: z.string().trim().regex(/^\d+$/, "amountMinor must be a non-negative integer string"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code")
    .optional(),
  description: z.string().trim().min(1).max(500),
  paymentMethodCode: z.string().trim().toUpperCase().min(1).max(32).optional(),
  categoryCode: z.string().trim().toUpperCase().min(1).max(32).optional(),
  idempotencyKey: idempotencyKeySchema.optional(),
});

export type RecordExpenseInput = z.infer<typeof recordExpenseInputSchema>;

export type ExpenseJson = {
  id: string;
  branchId: string;
  categoryCode: string;
  categoryName: string;
  paymentMethodCode: string | null;
  amountMinor: string;
  currency: string;
  description: string;
  status: "POSTED";
  occurredAt: string;
  createdAt: string;
};

export async function ensureDefaultExpenseCategory(
  tx: AppDatabase,
  organizationId: string,
): Promise<void> {
  await tx
    .insert(financeExpenseCategories)
    .values({
      id: createId(),
      organizationId,
      code: DEFAULT_EXPENSE_CATEGORY_CODE,
      name: "Purchase",
      status: "ACTIVE",
    })
    .onConflictDoNothing();
}

export async function recordExpense(
  db: AppDatabase,
  actor: OrganizationActor,
  input: RecordExpenseInput,
  idempotencyKey: string,
): Promise<{ expense: ExpenseJson; replayed: boolean }> {
  assertPermission(actor, PERMISSIONS.financeExpensesCreate);
  const key = idempotencyKeySchema.parse(idempotencyKey);
  const parsed = recordExpenseInputSchema.parse({ ...input, idempotencyKey: key });
  const amount = assertInt64Minor(parseMinorUnits(parsed.amountMinor));
  if (amount <= 0n) {
    throw new ValidationError("Expense amount must be greater than zero", "expense_amount_not_positive");
  }
  const description = parsed.description.trim();
  const categoryCode = parsed.categoryCode ?? DEFAULT_EXPENSE_CATEGORY_CODE;
  const paymentMethodCode = parsed.paymentMethodCode ?? DEFAULT_EXPENSE_PAYMENT_METHOD_CODE;

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    assertBranchAccess(actor, parsed.branchId, "OPERATE");
    await requireActiveBranch(tx, actor.organizationId, parsed.branchId);
    const currency = await loadOrganizationCurrency(tx, actor.organizationId);
    if (parsed.currency && parsed.currency !== currency) {
      throw new ValidationError("Expense currency must match the organization currency", "expense_currency_mismatch");
    }

    await ensureDefaultExpenseCategory(tx, actor.organizationId);
    await ensureDefaultPaymentMethods(tx, actor.organizationId);
    const category = await loadActiveCategoryByCode(tx, actor.organizationId, categoryCode);
    if (!category) {
      throw new ValidationError("Unsupported expense category", "unsupported_expense_category");
    }
    const method = await loadActivePaymentMethodByCode(tx, actor.organizationId, paymentMethodCode);
    if (!method) {
      throw new ValidationError("Unsupported payment method", "unsupported_payment_method");
    }

    const hash = expenseRequestHash({
      branchId: parsed.branchId,
      amountMinor: amount.toString(),
      currency,
      description,
      categoryCode: category.code,
      paymentMethodCode: method.code,
    });
    const now = await transactionNow(tx);
    const replay = await claimIdempotencyKey(tx, actor.organizationId, key, hash, now);
    if (replay) {
      return { expense: replay.expense, replayed: true };
    }

    const expenseId = createId();
    const inserted = await tx
      .insert(financeExpenses)
      .values({
        id: expenseId,
        organizationId: actor.organizationId,
        branchId: parsed.branchId,
        categoryId: category.id,
        paymentMethodId: method.id,
        amountMinor: amount,
        currency,
        description,
        status: "POSTED",
        occurredAt: now,
        createdBy: actor.userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ConflictError("Expense was not recorded");

    const expense = serializeExpense(row, {
      categoryCode: category.code,
      categoryName: category.name,
      paymentMethodCode: method.code,
    });

    await tx.insert(coreOutboxEvents).values({
      id: createId(),
      organizationId: actor.organizationId,
      branchId: parsed.branchId,
      eventType: "finance.expense.posted",
      aggregateType: "finance_expense",
      aggregateId: expenseId,
      payload: {
        expenseId,
        branchId: parsed.branchId,
        amountMinor: amount.toString(),
        currency,
        categoryCode: category.code,
        paymentMethodCode: method.code,
        description,
      },
    });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: parsed.branchId,
      actorUserId: actor.userId,
      action: "finance.expense.posted",
      entityType: "finance_expense",
      entityId: expenseId,
      after: {
        amountMinor: amount.toString(),
        currency,
        categoryCode: category.code,
        paymentMethodCode: method.code,
        status: "POSTED",
        description,
      },
    });

    await storeIdempotencyResponse(tx, actor.organizationId, key, { expense, replayed: false });
    return { expense, replayed: false };
  });
}

export async function sumPostedExpenses(
  db: AppDatabase,
  actor: OrganizationActor,
  input: { branchId: string; from: Date; to: Date },
): Promise<{ totalMinor: bigint; currency: string }> {
  assertPermission(actor, PERMISSIONS.financeExpensesRead);
  assertBranchAccess(actor, input.branchId, "VIEW");
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const currency = await loadOrganizationCurrency(tx, actor.organizationId);
    const rows = await tx
      .select({
        total: sql<string>`coalesce(sum(${financeExpenses.amountMinor}), 0)::text`,
      })
      .from(financeExpenses)
      .where(
        and(
          eq(financeExpenses.organizationId, actor.organizationId),
          eq(financeExpenses.branchId, input.branchId),
          eq(financeExpenses.status, "POSTED"),
          gte(financeExpenses.occurredAt, input.from),
          lt(financeExpenses.occurredAt, input.to),
        ),
      );
    const totalMinor = parseMinorUnits(rows[0]?.total ?? "0");
    return { totalMinor, currency };
  });
}

export async function loadExpenseCurrency(db: AppDatabase, actor: OrganizationActor): Promise<string> {
  assertPermission(actor, PERMISSIONS.financeExpensesCreate);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    loadOrganizationCurrency(tx, actor.organizationId),
  );
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

async function loadActiveCategoryByCode(
  tx: AppDatabase,
  organizationId: string,
  code: string,
) {
  const rows = await tx
    .select()
    .from(financeExpenseCategories)
    .where(
      and(
        eq(financeExpenseCategories.organizationId, organizationId),
        eq(financeExpenseCategories.code, code),
        eq(financeExpenseCategories.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
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

function serializeExpense(
  row: typeof financeExpenses.$inferSelect,
  extra: { categoryCode: string; categoryName: string; paymentMethodCode: string | null },
): ExpenseJson {
  return {
    id: row.id,
    branchId: row.branchId,
    categoryCode: extra.categoryCode,
    categoryName: extra.categoryName,
    paymentMethodCode: extra.paymentMethodCode,
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    description: row.description,
    status: "POSTED",
    occurredAt: iso(row.occurredAt),
    createdAt: iso(row.createdAt),
  };
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function expenseRequestHash(input: {
  branchId: string;
  amountMinor: string;
  currency: string;
  description: string;
  categoryCode: string;
  paymentMethodCode: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        branchId: input.branchId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        description: input.description,
        categoryCode: input.categoryCode,
        paymentMethodCode: input.paymentMethodCode,
      }),
    )
    .digest("hex");
}

async function transactionNow(tx: AppDatabase): Promise<Date> {
  const rows = await tx.select({ now: sql<Date>`now()` }).from(coreBranches).limit(1);
  const value = rows[0]?.now;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

async function claimIdempotencyKey(
  tx: AppDatabase,
  organizationId: string,
  key: string,
  hash: string,
  now: Date,
): Promise<{ expense: ExpenseJson; replayed: boolean } | null> {
  const inserted = await tx
    .insert(coreIdempotencyKeys)
    .values({
      id: createId(),
      organizationId,
      scope: EXPENSE_IDEMPOTENCY_SCOPE,
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
        eq(coreIdempotencyKeys.scope, EXPENSE_IDEMPOTENCY_SCOPE),
        eq(coreIdempotencyKeys.idempotencyKey, key),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    throw new ConflictError("Idempotency key conflict");
  }
  if (existing.requestHash && existing.requestHash !== hash) {
    throw new ConflictError("Idempotency key reused with a different expense");
  }
  if (!existing.responseBody) {
    throw new ConflictError("An expense with this idempotency key is already in progress");
  }
  return existing.responseBody as { expense: ExpenseJson; replayed: boolean };
}

async function storeIdempotencyResponse(
  tx: AppDatabase,
  organizationId: string,
  key: string,
  body: { expense: ExpenseJson; replayed: boolean },
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
        eq(coreIdempotencyKeys.scope, EXPENSE_IDEMPOTENCY_SCOPE),
        eq(coreIdempotencyKeys.idempotencyKey, key),
      ),
    );
}
