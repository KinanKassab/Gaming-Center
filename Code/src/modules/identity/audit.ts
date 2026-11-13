import { desc, eq } from "drizzle-orm";
import { assertPermission } from "@/core/tenancy";
import { createId } from "@/core/ids";
import { coreAuditLogs, coreUsers } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";

export type AuditEntry = {
  organizationId: string;
  branchId?: string | null;
  /** Null only for system-initiated events; admin mutations always have an actor. */
  actorUserId: string | null;
  action: string;
  entityType:
    | "organization"
    | "branch"
    | "user"
    | "membership"
    | "role"
    | "branch_access"
    | "customer"
    | "setting_value"
    | "organization_feature"
    | "gaming_area"
    | "gaming_device_type"
    | "gaming_device"
    | "gaming_pricing_plan"
    | "gaming_pricing_assignment"
    | "gaming_session"
    | "finance_charge"
    | "finance_payment"
    | "finance_expense"
    | "catalog_product"
    | "pos_order";
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Never place passwords, tokens, or other secrets here. */
  metadata?: Record<string, unknown> | null;
};

/** Appends an audit row inside the caller's transaction so audit and mutation commit atomically. */
export async function recordAudit(tx: AppDatabase, entry: AuditEntry): Promise<void> {
  await tx.insert(coreAuditLogs).values({
    id: createId(),
    organizationId: entry.organizationId,
    branchId: entry.branchId ?? null,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    beforeData: entry.before ?? null,
    afterData: entry.after ?? null,
    metadata: entry.metadata ?? null,
  });
}

export async function listAuditLogs(
  db: AppDatabase,
  actor: OrganizationActor,
  input?: { limit?: number },
) {
  assertPermission(actor, PERMISSIONS.auditRead);
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    tx
      .select({
        id: coreAuditLogs.id,
        organizationId: coreAuditLogs.organizationId,
        branchId: coreAuditLogs.branchId,
        actorUserId: coreAuditLogs.actorUserId,
        actorDisplayName: coreUsers.displayName,
        action: coreAuditLogs.action,
        entityType: coreAuditLogs.entityType,
        entityId: coreAuditLogs.entityId,
        beforeData: coreAuditLogs.beforeData,
        afterData: coreAuditLogs.afterData,
        metadata: coreAuditLogs.metadata,
        occurredAt: coreAuditLogs.occurredAt,
      })
      .from(coreAuditLogs)
      .leftJoin(coreUsers, eq(coreUsers.id, coreAuditLogs.actorUserId))
      .where(eq(coreAuditLogs.organizationId, actor.organizationId))
      .orderBy(desc(coreAuditLogs.occurredAt))
      .limit(limit),
  );
}
