import { and, eq } from "drizzle-orm";
import { createId } from "@/core/ids";
import { financePaymentMethods } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { assertPermission } from "@/core/tenancy";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";

const SHAMCASH_CONFIG = {
  recordingMode: "MANUAL",
  integration: "NEEDS_VERIFICATION",
} as const;

export type PaymentMethodRecord = typeof financePaymentMethods.$inferSelect;

/** Inserts CASH and SHAMCASH (manual record) when missing. Safe to call repeatedly. */
export async function ensureDefaultPaymentMethods(
  tx: AppDatabase,
  organizationId: string,
): Promise<void> {
  await insertMethod(tx, {
    organizationId,
    code: "CASH",
    name: "Cash",
    methodType: "CASH",
    requiresReference: false,
    config: null,
  });
  await insertMethod(tx, {
    organizationId,
    code: "SHAMCASH",
    name: "ShamCash",
    methodType: "MANUAL",
    requiresReference: false,
    config: SHAMCASH_CONFIG,
  });
}

async function insertMethod(
  tx: AppDatabase,
  input: {
    organizationId: string;
    code: string;
    name: string;
    methodType: string;
    requiresReference: boolean;
    config: Record<string, string> | null;
  },
): Promise<void> {
  await tx
    .insert(financePaymentMethods)
    .values({
      id: createId(),
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      methodType: input.methodType,
      requiresReference: input.requiresReference,
      status: "ACTIVE",
      config: input.config,
    })
    .onConflictDoNothing();
}

export async function listActivePaymentMethods(
  tx: AppDatabase,
  organizationId: string,
): Promise<PaymentMethodRecord[]> {
  await ensureDefaultPaymentMethods(tx, organizationId);
  return tx
    .select()
    .from(financePaymentMethods)
    .where(
      and(
        eq(financePaymentMethods.organizationId, organizationId),
        eq(financePaymentMethods.status, "ACTIVE"),
      ),
    )
    .orderBy(financePaymentMethods.code);
}

export async function listOrganizationPaymentMethods(
  db: AppDatabase,
  actor: OrganizationActor,
): Promise<PaymentMethodRecord[]> {
  assertPermission(actor, PERMISSIONS.financePaymentsRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    listActivePaymentMethods(tx, actor.organizationId),
  );
}

export async function loadActivePaymentMethodByCode(
  tx: AppDatabase,
  organizationId: string,
  code: string,
): Promise<PaymentMethodRecord | null> {
  await ensureDefaultPaymentMethods(tx, organizationId);
  const rows = await tx
    .select()
    .from(financePaymentMethods)
    .where(
      and(
        eq(financePaymentMethods.organizationId, organizationId),
        eq(financePaymentMethods.code, code),
        eq(financePaymentMethods.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
