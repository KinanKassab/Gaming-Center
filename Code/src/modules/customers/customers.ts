import { and, asc, desc, eq, ilike, ne, or } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, isForeignKeyViolation } from "@/core/errors";
import { createId } from "@/core/ids";
import { assertBranchAccess, assertPermission } from "@/core/tenancy";
import { coreBranches, coreCustomers } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { assertInt64Minor, parseMinorUnits } from "@/core/money";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { newPortalToken, postOpeningBalance } from "@/modules/finance/customer-ledger";
import { digitsOnly, likeSafe, normalizeEmail, normalizeOptionalText, normalizePhone } from "./normalize";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CUSTOMER_STATUSES = ["ACTIVE", "BLOCKED", "ARCHIVED"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_PAGE_SIZE = 50;
export const MAX_CUSTOMER_OFFSET = 100_000;

export const createCustomerInputSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  customerCode: z.string().max(64).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().max(320).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  createdBranchId: z.string().regex(UUID_PATTERN, "Invalid branch id").optional().nullable(),
  openingSide: z.enum(["DEBTOR", "CREDITOR"]).optional(),
  openingAmountMinor: z.string().trim().regex(/^\d+$/, "openingAmountMinor must be a non-negative integer string").optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;

export const updateCustomerInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    customerCode: z.string().max(64).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    email: z.string().max(320).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;

export const listCustomersInputSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "ARCHIVED"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(MAX_CUSTOMER_OFFSET).optional(),
});

export type ListCustomersInput = z.infer<typeof listCustomersInputSchema>;
export type CustomerPage = {
  customers: CustomerRecord[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type CustomerDuplicateWarning = {
  code: "DUPLICATE_PHONE" | "DUPLICATE_EMAIL" | "DUPLICATE_NAME";
  customerId: string;
  displayName: string;
};

export type CustomerRecord = typeof coreCustomers.$inferSelect;

export type CustomerWriteResult = {
  customer: CustomerRecord;
  warnings: CustomerDuplicateWarning[];
};

function snapshot(row: CustomerRecord) {
  return {
    displayName: row.displayName,
    customerCode: row.customerCode,
    phoneNormalized: row.phoneNormalized,
    emailNormalized: row.emailNormalized,
    status: row.status,
    notes: row.notes,
    createdBranchId: row.createdBranchId,
  };
}

async function loadOwnCustomer(
  tx: AppDatabase,
  organizationId: string,
  customerId: string,
): Promise<CustomerRecord> {
  const rows = await tx
    .select()
    .from(coreCustomers)
    .where(and(eq(coreCustomers.id, customerId), eq(coreCustomers.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Customer not found");
  return row;
}

async function requireActiveBranch(
  tx: AppDatabase,
  organizationId: string,
  branchId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: coreBranches.id, status: coreBranches.status })
    .from(coreBranches)
    .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, organizationId)))
    .limit(1);
  const branch = rows[0];
  if (!branch) throw new NotFoundError("Branch not found in this organization");
  if (branch.status === "ARCHIVED") throw new ConflictError("Branch is archived");
}

async function duplicateWarnings(
  tx: AppDatabase,
  organizationId: string,
  input: { displayName: string; phoneNormalized: string | null; emailNormalized: string | null },
  exceptCustomerId?: string,
): Promise<CustomerDuplicateWarning[]> {
  const warnings: CustomerDuplicateWarning[] = [];
  const candidates = await tx
    .select({
      id: coreCustomers.id,
      displayName: coreCustomers.displayName,
      phoneNormalized: coreCustomers.phoneNormalized,
      emailNormalized: coreCustomers.emailNormalized,
    })
    .from(coreCustomers)
    .where(and(eq(coreCustomers.organizationId, organizationId), ne(coreCustomers.status, "ARCHIVED")));

  for (const row of candidates) {
    if (exceptCustomerId && row.id === exceptCustomerId) continue;
    if (input.displayName && row.displayName.trim().toLowerCase() === input.displayName.trim().toLowerCase()) {
      warnings.push({ code: "DUPLICATE_NAME", customerId: row.id, displayName: row.displayName });
    }
    if (input.phoneNormalized && row.phoneNormalized === input.phoneNormalized) {
      warnings.push({ code: "DUPLICATE_PHONE", customerId: row.id, displayName: row.displayName });
    }
    if (input.emailNormalized && row.emailNormalized === input.emailNormalized) {
      warnings.push({ code: "DUPLICATE_EMAIL", customerId: row.id, displayName: row.displayName });
    }
  }
  return warnings;
}

export async function listCustomerPage(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListCustomersInput = {},
): Promise<CustomerPage> {
  assertPermission(actor, PERMISSIONS.customersRead);
  const limit = input.limit ?? CUSTOMER_PAGE_SIZE;
  const offset = input.offset ?? 0;
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const filters = [eq(coreCustomers.organizationId, actor.organizationId)];
    if (input.status) {
      filters.push(eq(coreCustomers.status, input.status));
    } else {
      filters.push(ne(coreCustomers.status, "ARCHIVED"));
    }

    const q = input.q?.trim() ?? "";
    if (q) {
      const safe = likeSafe(q);
      const phoneDigits = digitsOnly(q);
      const searchParts = [];
      if (safe) {
        const pattern = `%${safe}%`;
        searchParts.push(ilike(coreCustomers.displayName, pattern));
        searchParts.push(ilike(coreCustomers.customerCode, pattern));
        searchParts.push(ilike(coreCustomers.emailNormalized, `%${safe.toLowerCase()}%`));
      }
      if (phoneDigits.length >= 3) {
        searchParts.push(ilike(coreCustomers.phoneNormalized, `%${phoneDigits}%`));
      }
      if (searchParts.length > 0) {
        filters.push(or(...searchParts)!);
      }
    }

    const rows = await tx
      .select()
      .from(coreCustomers)
      .where(and(...filters))
      .orderBy(coreCustomers.displayName, desc(coreCustomers.createdAt), asc(coreCustomers.id))
      .limit(limit + 1)
      .offset(offset);
    return {
      customers: rows.slice(0, limit),
      limit,
      offset,
      hasMore: rows.length > limit,
    };
  });
}

export async function listCustomers(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListCustomersInput = {},
): Promise<CustomerRecord[]> {
  return (await listCustomerPage(db, actor, input)).customers;
}

export async function getCustomer(
  db: AppDatabase,
  actor: OrganizationActor,
  customerId: string,
): Promise<CustomerRecord> {
  assertPermission(actor, PERMISSIONS.customersRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    loadOwnCustomer(tx, actor.organizationId, customerId),
  );
}

export async function createCustomer(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreateCustomerInput,
): Promise<CustomerWriteResult> {
  assertPermission(actor, PERMISSIONS.customersManage);
  const displayName = input.displayName.trim();
  if (displayName.length < 1) {
    throw new ValidationError("Display name is required");
  }
  const customerCode = normalizeOptionalText(input.customerCode, 64);
  const phoneNormalized = normalizePhone(input.phone);
  const emailNormalized = normalizeEmail(input.email);
  const notes = normalizeOptionalText(input.notes, 4000);
  const createdBranchId = input.createdBranchId ?? null;
  const openingAmount = input.openingAmountMinor ? assertInt64Minor(parseMinorUnits(input.openingAmountMinor)) : 0n;
  if (openingAmount > 0n && !input.openingSide) {
    throw new ValidationError("Choose whether the opening amount is debt or credit");
  }
  if (openingAmount > 0n && !createdBranchId) {
    throw new ValidationError("A branch is required to record an opening balance");
  }
  if (createdBranchId) {
    assertBranchAccess(actor, createdBranchId, openingAmount > 0n ? "OPERATE" : "VIEW");
  }

  const customerId = createId();
  try {
    return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      if (createdBranchId) {
        await requireActiveBranch(tx, actor.organizationId, createdBranchId);
      }

      const inserted = await tx
        .insert(coreCustomers)
        .values({
          id: customerId,
          organizationId: actor.organizationId,
          customerCode,
          displayName,
          phoneNormalized,
          emailNormalized,
          status: "ACTIVE",
          notes,
          portalToken: newPortalToken(),
          createdBranchId,
          createdBy: actor.userId,
        })
        .returning();
      const customer = inserted[0]!;

      if (openingAmount > 0n && input.openingSide && createdBranchId) {
        await postOpeningBalance(tx, actor, {
          customerId,
          branchId: createdBranchId,
          side: input.openingSide,
          amountMinor: openingAmount,
          occurredAt: customer.createdAt,
        });
      }

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        branchId: createdBranchId,
        actorUserId: actor.userId,
        action: "core.customer.created",
        entityType: "customer",
        entityId: customerId,
        after: snapshot(customer),
      });

      const warnings = await duplicateWarnings(
        tx,
        actor.organizationId,
        { displayName, phoneNormalized, emailNormalized },
        customerId,
      );
      return { customer, warnings };
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ValidationError("Invalid branch for this organization");
    }
    throw error;
  }
}

export async function updateCustomer(
  db: AppDatabase,
  actor: OrganizationActor,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<CustomerWriteResult> {
  assertPermission(actor, PERMISSIONS.customersManage);
  const nextName = input.displayName !== undefined ? input.displayName.trim() : undefined;
  if (nextName === "") {
    throw new ValidationError("Display name is required");
  }
  const nextCode = input.customerCode !== undefined ? normalizeOptionalText(input.customerCode, 64) : undefined;
  const nextPhone = input.phone !== undefined ? normalizePhone(input.phone) : undefined;
  const nextEmail = input.email !== undefined ? normalizeEmail(input.email) : undefined;
  const nextNotes = input.notes !== undefined ? normalizeOptionalText(input.notes, 4000) : undefined;

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnCustomer(tx, actor.organizationId, customerId);
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Archived customer cannot be updated");
    }

    const patch = {
      displayName: nextName ?? before.displayName,
      customerCode: nextCode === undefined ? before.customerCode : nextCode,
      phoneNormalized: nextPhone === undefined ? before.phoneNormalized : nextPhone,
      emailNormalized: nextEmail === undefined ? before.emailNormalized : nextEmail,
      notes: nextNotes === undefined ? before.notes : nextNotes,
      status: input.status ?? before.status,
    };

    const updated = await tx
      .update(coreCustomers)
      .set(patch)
      .where(and(eq(coreCustomers.id, customerId), eq(coreCustomers.organizationId, actor.organizationId)))
      .returning();
    const customer = updated[0]!;

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: customer.createdBranchId,
      actorUserId: actor.userId,
      action: "core.customer.updated",
      entityType: "customer",
      entityId: customerId,
      before: snapshot(before),
      after: snapshot(customer),
    });

    const warnings = await duplicateWarnings(
      tx,
      actor.organizationId,
      {
        displayName: customer.displayName,
        phoneNormalized: customer.phoneNormalized,
        emailNormalized: customer.emailNormalized,
      },
      customerId,
    );
    return { customer, warnings };
  });
}

export async function archiveCustomer(
  db: AppDatabase,
  actor: OrganizationActor,
  customerId: string,
): Promise<CustomerRecord> {
  assertPermission(actor, PERMISSIONS.customersManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnCustomer(tx, actor.organizationId, customerId);
    if (before.status === "ARCHIVED") {
      throw new ConflictError("Customer is already archived");
    }

    const updated = await tx
      .update(coreCustomers)
      .set({ status: "ARCHIVED" })
      .where(and(eq(coreCustomers.id, customerId), eq(coreCustomers.organizationId, actor.organizationId)))
      .returning();
    const customer = updated[0]!;

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: customer.createdBranchId,
      actorUserId: actor.userId,
      action: "core.customer.archived",
      entityType: "customer",
      entityId: customerId,
      before: { status: before.status },
      after: { status: "ARCHIVED" },
    });

    return customer;
  });
}
