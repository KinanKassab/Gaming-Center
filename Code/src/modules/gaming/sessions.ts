import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  BillingError,
  isUniqueViolation,
} from "@/core/errors";
import { createId } from "@/core/ids";
import { parseMinorUnits } from "@/core/money";
import { assertPermission } from "@/core/tenancy";
import {
  coreBranches,
  coreCustomers,
  coreOutboxEvents,
  gamingDevices,
  gamingSessionPauses,
  gamingSessionSegments,
  gamingSessions,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { readEffectiveSettingValue } from "@/modules/settings";
import { grantedBranchIds, requireBranchAccess } from "./access";
import { calculateSegmentLine, parsePricingSnapshot, PACKAGE_MULTI_SEGMENT_MESSAGE } from "./billing-calculator";
import { TIME_BILLING_PRORATED_HOUR } from "./billing-prorated";
import { persistBillingInTransaction } from "./billing";
import { normalizeOptionalText, uuidPattern } from "./normalize";
import { resolveDevicePricing } from "./pricing-resolve";

export const SESSION_STATUSES = ["ACTIVE", "PAUSED", "ENDING", "COMPLETED", "CANCELLED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_TYPES = ["OPEN", "FIXED"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const SEGMENT_END_REASONS = ["MOVE", "PRICE_CHANGE", "SESSION_END", "CANCEL"] as const;

export const startSessionInputSchema = z.object({
  deviceId: z.string().regex(uuidPattern, "Invalid device id"),
  customerId: z.string().regex(uuidPattern, "Invalid customer id").optional().nullable(),
  sessionType: z.enum(["OPEN", "FIXED"]).optional(),
  requestedEndAt: z.coerce.date().optional().nullable(),
});

export type StartSessionInput = z.infer<typeof startSessionInputSchema>;

export const pauseSessionInputSchema = z.object({
  reason: z.string().max(4000).optional().nullable(),
});

export type PauseSessionInput = z.infer<typeof pauseSessionInputSchema>;

export const cancelSessionInputSchema = z.object({
  reason: z.string().trim().min(1).max(4000),
});

export type CancelSessionInput = z.infer<typeof cancelSessionInputSchema>;

export const moveSessionInputSchema = z.object({
  deviceId: z.string().regex(uuidPattern, "Invalid device id"),
});

export type MoveSessionInput = z.infer<typeof moveSessionInputSchema>;

export const assignSessionCustomerInputSchema = z.object({
  customerId: z.string().regex(uuidPattern, "Invalid customer id"),
});

export type AssignSessionCustomerInput = z.infer<typeof assignSessionCustomerInputSchema>;

export const listSessionsInputSchema = z.object({
  branchId: z.string().regex(uuidPattern, "Invalid branch id").optional(),
  deviceId: z.string().regex(uuidPattern, "Invalid device id").optional(),
  customerId: z.string().regex(uuidPattern, "Invalid customer id").optional(),
  status: z.enum(["ACTIVE", "PAUSED", "ENDING", "COMPLETED", "CANCELLED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

export type ListSessionsInput = z.infer<typeof listSessionsInputSchema>;

export type SessionRecord = typeof gamingSessions.$inferSelect;
export type SessionSegmentRecord = typeof gamingSessionSegments.$inferSelect;
export type SessionPauseRecord = typeof gamingSessionPauses.$inferSelect;

export type SessionJson = Omit<SessionRecord, "gamingTotalMinor"> & {
  gamingTotalMinor: string | null;
};

export type SessionSegmentJson = Omit<SessionSegmentRecord, "computedAmountMinor"> & {
  computedAmountMinor: string | null;
};

export type SessionDetail = {
  session: SessionJson;
  segments: SessionSegmentJson[];
  pauses: SessionPauseRecord[];
};

export function serializeSession(row: SessionRecord): SessionJson {
  return {
    ...row,
    gamingTotalMinor: row.gamingTotalMinor == null ? null : row.gamingTotalMinor.toString(),
  };
}

export function serializeSegment(row: SessionSegmentRecord): SessionSegmentJson {
  return {
    ...row,
    computedAmountMinor: row.computedAmountMinor == null ? null : row.computedAmountMinor.toString(),
  };
}

function uniqueConstraintText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current && typeof current === "object") {
    const row = current as Record<string, unknown>;
    for (const key of ["constraint", "constraint_name", "constraintName"]) {
      if (typeof row[key] === "string") parts.push(row[key] as string);
    }
    if (typeof row.message === "string") parts.push(row.message);
    if (typeof row.detail === "string") parts.push(row.detail);
    current = row.cause;
  }
  return parts.join(" ");
}

function mapSessionWriteError(error: unknown): never {
  if (isUniqueViolation(error)) {
    const text = uniqueConstraintText(error);
    if (text.includes("one_active_per_device")) {
      throw new ConflictError("Device is already occupied");
    }
    if (text.includes("org_branch_number") || text.includes("session_number")) {
      throw new ConflictError("Session number conflict; retry the start");
    }
    throw new ConflictError("Session conflict");
  }
  throw error;
}

async function transactionNow(tx: AppDatabase): Promise<Date> {
  const rows = await tx.select({ now: sql<Date>`now()` }).from(coreBranches).limit(1);
  const value = rows[0]?.now;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

async function lockBranch(
  tx: AppDatabase,
  organizationId: string,
  branchId: string,
): Promise<{ id: string; status: string }> {
  await tx.execute(
    sql`select id from core_branches where id = ${branchId} and organization_id = ${organizationId} for update`,
  );
  const rows = await tx
    .select({ id: coreBranches.id, status: coreBranches.status })
    .from(coreBranches)
    .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, organizationId)))
    .limit(1);
  const branch = rows[0];
  if (!branch) throw new NotFoundError("Branch not found in this organization");
  if (branch.status === "ARCHIVED") throw new ConflictError("Branch is archived");
  return branch;
}

async function lockDevice(
  tx: AppDatabase,
  organizationId: string,
  deviceId: string,
): Promise<typeof gamingDevices.$inferSelect> {
  await tx.execute(
    sql`select id from gaming_devices where id = ${deviceId} and organization_id = ${organizationId} for update`,
  );
  const rows = await tx
    .select()
    .from(gamingDevices)
    .where(and(eq(gamingDevices.id, deviceId), eq(gamingDevices.organizationId, organizationId)))
    .limit(1);
  const device = rows[0];
  if (!device) throw new NotFoundError("Device not found");
  return device;
}

async function lockDevicesInIdOrder(
  tx: AppDatabase,
  organizationId: string,
  deviceIds: string[],
): Promise<void> {
  const unique = [...new Set(deviceIds)].sort();
  for (const deviceId of unique) {
    await tx.execute(
      sql`select id from gaming_devices where id = ${deviceId} and organization_id = ${organizationId} for update`,
    );
  }
}

async function lockSession(
  tx: AppDatabase,
  organizationId: string,
  sessionId: string,
): Promise<SessionRecord> {
  await tx.execute(
    sql`select id from gaming_sessions where id = ${sessionId} and organization_id = ${organizationId} for update`,
  );
  return loadOwnSession(tx, organizationId, sessionId);
}

async function loadOwnSession(
  tx: AppDatabase,
  organizationId: string,
  sessionId: string,
): Promise<SessionRecord> {
  const rows = await tx
    .select()
    .from(gamingSessions)
    .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Session not found");
  return row;
}

async function requirePlayableDevice(device: typeof gamingDevices.$inferSelect): Promise<void> {
  if (device.archivedAt) {
    throw new ConflictError("Device is archived");
  }
  if (device.operationalStatus === "MAINTENANCE") {
    throw new ConflictError("Device is in maintenance");
  }
  if (device.operationalStatus === "DISABLED") {
    throw new ConflictError("Device is disabled");
  }
  if (device.operationalStatus !== "ENABLED") {
    throw new ConflictError("Device is not available");
  }
}

async function assertDeviceFree(
  tx: AppDatabase,
  deviceId: string,
  exceptSessionId?: string,
): Promise<void> {
  const filters = [
    eq(gamingSessions.currentDeviceId, deviceId),
    inArray(gamingSessions.status, ["ACTIVE", "PAUSED"]),
  ];
  const occupying = await tx
    .select({ id: gamingSessions.id })
    .from(gamingSessions)
    .where(and(...filters))
    .limit(2);
  const other = occupying.find((row) => row.id !== exceptSessionId);
  if (other) {
    throw new ConflictError("Device is already occupied");
  }
}

async function nextSessionNumber(
  tx: AppDatabase,
  organizationId: string,
  branchId: string,
): Promise<string> {
  const rows = await tx
    .select({
      n: sql<string>`coalesce(max(${gamingSessions.sessionNumber}::bigint), 0)`,
    })
    .from(gamingSessions)
    .where(and(eq(gamingSessions.organizationId, organizationId), eq(gamingSessions.branchId, branchId)));
  return (BigInt(rows[0]?.n ?? "0") + 1n).toString();
}

async function loadUsableCustomer(
  tx: AppDatabase,
  organizationId: string,
  customerId: string,
): Promise<typeof coreCustomers.$inferSelect> {
  const rows = await tx
    .select()
    .from(coreCustomers)
    .where(and(eq(coreCustomers.id, customerId), eq(coreCustomers.organizationId, organizationId)))
    .limit(1);
  const customer = rows[0];
  if (!customer) throw new NotFoundError("Customer not found");
  if (customer.status === "ARCHIVED") {
    throw new ConflictError("Customer is archived");
  }
  if (customer.status === "BLOCKED") {
    throw new ConflictError("Customer is blocked");
  }
  if (customer.status !== "ACTIVE") {
    throw new ConflictError("Customer cannot be used for a session");
  }
  return customer;
}

async function assertGuestAllowed(
  tx: AppDatabase,
  organizationId: string,
  branchId: string,
): Promise<void> {
  const value = await readEffectiveSettingValue(tx, organizationId, "gaming.allow_guest_sessions", branchId);
  if (value !== true) {
    throw new ConflictError("Guest sessions are disabled");
  }
}

async function loadOpenSegment(
  tx: AppDatabase,
  sessionId: string,
): Promise<SessionSegmentRecord> {
  const rows = await tx
    .select()
    .from(gamingSessionSegments)
    .where(and(eq(gamingSessionSegments.sessionId, sessionId), isNull(gamingSessionSegments.endedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ConflictError("Session has no open segment");
  return row;
}

async function closeOpenPauseIfAny(
  tx: AppDatabase,
  sessionId: string,
  at: Date,
): Promise<SessionPauseRecord | null> {
  const updated = await tx
    .update(gamingSessionPauses)
    .set({ endedAt: at })
    .where(and(eq(gamingSessionPauses.sessionId, sessionId), isNull(gamingSessionPauses.endedAt)))
    .returning();
  return updated[0] ?? null;
}

async function writeOutbox(
  tx: AppDatabase,
  input: {
    organizationId: string;
    branchId: string;
    eventType: string;
    sessionId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(coreOutboxEvents).values({
    id: createId(),
    organizationId: input.organizationId,
    branchId: input.branchId,
    eventType: input.eventType,
    aggregateType: "gaming_session",
    aggregateId: input.sessionId,
    payload: input.payload,
  });
}

function sessionMeta(row: SessionRecord) {
  return {
    sessionNumber: row.sessionNumber,
    status: row.status,
    currentDeviceId: row.currentDeviceId,
    customerId: row.customerId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    gamingTotalMinor: row.gamingTotalMinor == null ? null : row.gamingTotalMinor.toString(),
    billingFinalizedAt: row.billingFinalizedAt ? row.billingFinalizedAt.toISOString() : null,
  };
}

async function loadSessionPauses(tx: AppDatabase, sessionId: string) {
  return tx
    .select()
    .from(gamingSessionPauses)
    .where(eq(gamingSessionPauses.sessionId, sessionId));
}

function closedSegmentAmount(
  segment: SessionSegmentRecord,
  pauses: SessionPauseRecord[],
  endedAt: Date,
): bigint | undefined {
  try {
    const line = calculateSegmentLine(
      {
        id: segment.id,
        deviceId: segment.deviceId,
        pricingPlanId: segment.pricingPlanId,
        startedAt: segment.startedAt,
        endedAt,
        pricingSnapshot: segment.pricingSnapshot,
        computedAmountMinor: segment.computedAmountMinor,
      },
      pauses.map((pause) => ({
        id: pause.id,
        startedAt: pause.startedAt,
        endedAt: pause.endedAt,
        isBillable: pause.isBillable,
      })),
      endedAt,
      "final",
    );
    if (line.timeBillingMode === TIME_BILLING_PRORATED_HOUR) return undefined;
    return parseMinorUnits(line.amountMinor);
  } catch (error) {
    if (error instanceof BillingError) return undefined;
    throw error;
  }
}

export async function startSession(
  db: AppDatabase,
  actor: OrganizationActor,
  input: StartSessionInput,
): Promise<SessionJson> {
  assertPermission(actor, PERMISSIONS.gamingSessionsStart);
  const sessionType = input.sessionType ?? "OPEN";
  if (sessionType === "FIXED" && !input.requestedEndAt) {
    throw new ValidationError("FIXED sessions require requestedEndAt");
  }
  if (sessionType === "OPEN" && input.requestedEndAt) {
    throw new ValidationError("OPEN sessions cannot set requestedEndAt");
  }

  try {
    return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      const now = await transactionNow(tx);
      if (sessionType === "FIXED" && input.requestedEndAt && input.requestedEndAt <= now) {
        throw new ValidationError("requestedEndAt must be in the future");
      }

      const device = await lockDevice(tx, actor.organizationId, input.deviceId);
      await lockBranch(tx, actor.organizationId, device.branchId);
      requireBranchAccess(actor, device.branchId, "OPERATE");
      await requirePlayableDevice(device);
      await assertDeviceFree(tx, device.id);

      const customerId = input.customerId ?? null;
      if (customerId) {
        await loadUsableCustomer(tx, actor.organizationId, customerId);
      } else {
        await assertGuestAllowed(tx, actor.organizationId, device.branchId);
      }

      const pricing = await resolveDevicePricing(tx, device, now);
      const sessionNumber = await nextSessionNumber(tx, actor.organizationId, device.branchId);
      const sessionId = createId();
      const segmentId = createId();

      const inserted = await tx
        .insert(gamingSessions)
        .values({
          id: sessionId,
          organizationId: actor.organizationId,
          branchId: device.branchId,
          sessionNumber,
          customerId,
          sessionType,
          status: "ACTIVE",
          currentDeviceId: device.id,
          startedAt: now,
          requestedEndAt: sessionType === "FIXED" ? input.requestedEndAt : null,
          createdBy: actor.userId,
        })
        .returning();
      const session = inserted[0]!;

      await tx.insert(gamingSessionSegments).values({
        id: segmentId,
        organizationId: actor.organizationId,
        branchId: device.branchId,
        sessionId,
        deviceId: device.id,
        pricingPlanId: pricing.pricingPlanId,
        startedAt: now,
        pricingSnapshot: pricing.snapshot,
      });

      await writeOutbox(tx, {
        organizationId: actor.organizationId,
        branchId: device.branchId,
        eventType: "gaming.session.started",
        sessionId,
        payload: {
          sessionId,
          deviceId: device.id,
          customerId,
          sessionNumber,
          startedAt: now.toISOString(),
        },
      });
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        branchId: device.branchId,
        actorUserId: actor.userId,
        action: "gaming.session.started",
        entityType: "gaming_session",
        entityId: sessionId,
        after: sessionMeta(session),
        metadata: { deviceId: device.id, customerId, pricingPlanId: pricing.pricingPlanId },
      });
      return serializeSession(session);
    });
  } catch (error) {
    mapSessionWriteError(error);
  }
}

export async function getSession(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
): Promise<SessionDetail> {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await loadOwnSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "VIEW");
    const segments = await tx
      .select()
      .from(gamingSessionSegments)
      .where(eq(gamingSessionSegments.sessionId, sessionId))
      .orderBy(gamingSessionSegments.startedAt);
    const pauses = await tx
      .select()
      .from(gamingSessionPauses)
      .where(eq(gamingSessionPauses.sessionId, sessionId))
      .orderBy(gamingSessionPauses.startedAt);
    return {
      session: serializeSession(session),
      segments: segments.map(serializeSegment),
      pauses,
    };
  });
}

export async function listSessions(
  db: AppDatabase,
  actor: OrganizationActor,
  input: ListSessionsInput = {},
): Promise<SessionJson[]> {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    if (input.branchId) {
      requireBranchAccess(actor, input.branchId, "VIEW");
    }
    const visible = input.branchId ? [input.branchId] : grantedBranchIds(actor, "VIEW");
    if (visible.length === 0) return [];

    const filters = [
      eq(gamingSessions.organizationId, actor.organizationId),
      inArray(gamingSessions.branchId, visible),
    ];
    if (input.deviceId) {
      const onDevice = await tx
        .selectDistinct({ sessionId: gamingSessionSegments.sessionId })
        .from(gamingSessionSegments)
        .where(
          and(
            eq(gamingSessionSegments.organizationId, actor.organizationId),
            eq(gamingSessionSegments.deviceId, input.deviceId),
          ),
        );
      const ids = onDevice.map((row) => row.sessionId);
      if (ids.length === 0) return [];
      filters.push(inArray(gamingSessions.id, ids));
    }
    if (input.customerId) filters.push(eq(gamingSessions.customerId, input.customerId));
    if (input.status) filters.push(eq(gamingSessions.status, input.status));
    if (input.from) filters.push(gte(gamingSessions.startedAt, input.from));
    if (input.to) filters.push(lte(gamingSessions.startedAt, input.to));

    const rows = await tx
      .select()
      .from(gamingSessions)
      .where(and(...filters))
      .orderBy(desc(gamingSessions.startedAt))
      .limit(limit)
      .offset(offset);
    return rows.map(serializeSession);
  });
}

export async function pauseSession(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
  input: PauseSessionInput = {},
): Promise<SessionJson> {
  assertPermission(actor, PERMISSIONS.gamingSessionsOperate);
  const reason = normalizeOptionalText(input.reason, 4000);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await lockSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "OPERATE");
    if (session.status !== "ACTIVE") {
      throw new ConflictError("Only an ACTIVE session can be paused");
    }
    const now = await transactionNow(tx);
    await tx.insert(gamingSessionPauses).values({
      id: createId(),
      organizationId: actor.organizationId,
      branchId: session.branchId,
      sessionId,
      startedAt: now,
      isBillable: false,
      reason,
      createdBy: actor.userId,
    });
    const updated = await tx
      .update(gamingSessions)
      .set({ status: "PAUSED" })
      .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, actor.organizationId)))
      .returning();
    const next = updated[0]!;
    await writeOutbox(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      eventType: "gaming.session.paused",
      sessionId,
      payload: { sessionId, deviceId: session.currentDeviceId, pausedAt: now.toISOString() },
    });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      actorUserId: actor.userId,
      action: "gaming.session.paused",
      entityType: "gaming_session",
      entityId: sessionId,
      before: sessionMeta(session),
      after: sessionMeta(next),
      metadata: { deviceId: session.currentDeviceId, reason },
    });
    return serializeSession(next);
  });
}

export async function resumeSession(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
): Promise<SessionJson> {
  assertPermission(actor, PERMISSIONS.gamingSessionsOperate);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await lockSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "OPERATE");
    if (session.status !== "PAUSED") {
      throw new ConflictError("Only a PAUSED session can be resumed");
    }
    const now = await transactionNow(tx);
    const closed = await closeOpenPauseIfAny(tx, sessionId, now);
    if (!closed) {
      throw new ConflictError("Paused session is missing an open pause");
    }
    const updated = await tx
      .update(gamingSessions)
      .set({ status: "ACTIVE" })
      .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, actor.organizationId)))
      .returning();
    const next = updated[0]!;
    await writeOutbox(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      eventType: "gaming.session.resumed",
      sessionId,
      payload: { sessionId, deviceId: session.currentDeviceId, resumedAt: now.toISOString() },
    });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      actorUserId: actor.userId,
      action: "gaming.session.resumed",
      entityType: "gaming_session",
      entityId: sessionId,
      before: sessionMeta(session),
      after: sessionMeta(next),
      metadata: { deviceId: session.currentDeviceId },
    });
    return serializeSession(next);
  });
}

export async function endSession(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
): Promise<SessionJson> {
  assertPermission(actor, PERMISSIONS.gamingSessionsOperate);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await lockSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "OPERATE");
    if (session.status !== "ACTIVE" && session.status !== "PAUSED") {
      throw new ConflictError("Session cannot be ended from its current status");
    }
    const now = await transactionNow(tx);
    await closeOpenPauseIfAny(tx, sessionId, now);
    const open = await loadOpenSegment(tx, sessionId);
    const pauses = await loadSessionPauses(tx, sessionId);
    const segmentAmount = closedSegmentAmount(open, pauses, now);
    await tx
      .update(gamingSessionSegments)
      .set({
        endedAt: now,
        endReason: "SESSION_END",
        ...(segmentAmount != null ? { computedAmountMinor: segmentAmount } : {}),
      })
      .where(eq(gamingSessionSegments.id, open.id));
    const updated = await tx
      .update(gamingSessions)
      .set({
        status: "COMPLETED",
        currentDeviceId: null,
        endedAt: now,
        closedBy: actor.userId,
      })
      .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, actor.organizationId)))
      .returning();
    const next = updated[0]!;
    const billed = await persistBillingInTransaction(tx, actor, sessionId, now);
    const billedRow = billed ? await loadOwnSession(tx, actor.organizationId, sessionId) : next;
    await writeOutbox(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      eventType: "gaming.session.completed",
      sessionId,
      payload: {
        sessionId,
        deviceId: session.currentDeviceId,
        endedAt: now.toISOString(),
        gamingTotalMinor: billed?.totalMinor ?? null,
      },
    });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      actorUserId: actor.userId,
      action: "gaming.session.ended",
      entityType: "gaming_session",
      entityId: sessionId,
      before: sessionMeta(session),
      after: sessionMeta(billedRow),
      metadata: { deviceId: session.currentDeviceId, customerId: session.customerId },
    });
    return serializeSession(billedRow);
  });
}

export async function cancelSession(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
  input: CancelSessionInput,
): Promise<SessionJson> {
  assertPermission(actor, PERMISSIONS.gamingSessionsCancel);
  const reason = input.reason.trim();
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await lockSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "MANAGE");
    if (session.status !== "ACTIVE" && session.status !== "PAUSED") {
      throw new ConflictError("Session cannot be cancelled from its current status");
    }
    const now = await transactionNow(tx);
    await closeOpenPauseIfAny(tx, sessionId, now);
    const open = await loadOpenSegment(tx, sessionId);
    await tx
      .update(gamingSessionSegments)
      .set({ endedAt: now, endReason: "CANCEL" })
      .where(eq(gamingSessionSegments.id, open.id));
    const updated = await tx
      .update(gamingSessions)
      .set({
        status: "CANCELLED",
        currentDeviceId: null,
        endedAt: now,
        closedBy: actor.userId,
        cancelReason: reason,
      })
      .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, actor.organizationId)))
      .returning();
    const next = updated[0]!;
    await writeOutbox(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      eventType: "gaming.session.cancelled",
      sessionId,
      payload: {
        sessionId,
        deviceId: session.currentDeviceId,
        endedAt: now.toISOString(),
        cancelReason: reason,
      },
    });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      actorUserId: actor.userId,
      action: "gaming.session.cancelled",
      entityType: "gaming_session",
      entityId: sessionId,
      before: sessionMeta(session),
      after: sessionMeta(next),
      metadata: { deviceId: session.currentDeviceId, customerId: session.customerId, reason },
    });
    return serializeSession(next);
  });
}

export async function moveSession(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
  input: MoveSessionInput,
): Promise<SessionJson> {
  assertPermission(actor, PERMISSIONS.gamingSessionsOperate);
  try {
    return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      const session = await lockSession(tx, actor.organizationId, sessionId);
      requireBranchAccess(actor, session.branchId, "OPERATE");
      if (session.status !== "ACTIVE" && session.status !== "PAUSED") {
        throw new ConflictError("Only an ACTIVE or PAUSED session can be moved");
      }
      if (!session.currentDeviceId) {
        throw new ConflictError("Session has no current device");
      }
      if (session.currentDeviceId === input.deviceId) {
        throw new ValidationError("Session is already on this device");
      }

      await lockDevicesInIdOrder(tx, actor.organizationId, [session.currentDeviceId, input.deviceId]);
      const current = await lockDevice(tx, actor.organizationId, session.currentDeviceId);
      const target = await lockDevice(tx, actor.organizationId, input.deviceId);
      if (target.branchId !== session.branchId) {
        throw new ValidationError("Cannot move a session to a device in another branch");
      }
      await requirePlayableDevice(target);
      await assertDeviceFree(tx, target.id, session.id);

      const now = await transactionNow(tx);
      const pricing = await resolveDevicePricing(tx, target, now);
      const open = await loadOpenSegment(tx, sessionId);
      const currentPricing = parsePricingSnapshot(open.pricingSnapshot);
      if (currentPricing.pricingModel === "PACKAGE" || pricing.snapshot.pricingModel === "PACKAGE") {
        throw new ConflictError(PACKAGE_MULTI_SEGMENT_MESSAGE);
      }
      const pauses = await loadSessionPauses(tx, sessionId);
      const segmentAmount = closedSegmentAmount(open, pauses, now);
      await tx
        .update(gamingSessionSegments)
        .set({
          endedAt: now,
          endReason: "MOVE",
          ...(segmentAmount != null ? { computedAmountMinor: segmentAmount } : {}),
        })
        .where(eq(gamingSessionSegments.id, open.id));
      await tx.insert(gamingSessionSegments).values({
        id: createId(),
        organizationId: actor.organizationId,
        branchId: session.branchId,
        sessionId,
        deviceId: target.id,
        pricingPlanId: pricing.pricingPlanId,
        startedAt: now,
        pricingSnapshot: pricing.snapshot,
      });
      const updated = await tx
        .update(gamingSessions)
        .set({ currentDeviceId: target.id })
        .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, actor.organizationId)))
        .returning();
      const next = updated[0]!;
      await writeOutbox(tx, {
        organizationId: actor.organizationId,
        branchId: session.branchId,
        eventType: "gaming.session.moved",
        sessionId,
        payload: {
          sessionId,
          fromDeviceId: current.id,
          toDeviceId: target.id,
          movedAt: now.toISOString(),
        },
      });
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        branchId: session.branchId,
        actorUserId: actor.userId,
        action: "gaming.session.moved",
        entityType: "gaming_session",
        entityId: sessionId,
        before: sessionMeta(session),
        after: sessionMeta(next),
        metadata: { fromDeviceId: current.id, toDeviceId: target.id, pricingPlanId: pricing.pricingPlanId },
      });
      return serializeSession(next);
    });
  } catch (error) {
    mapSessionWriteError(error);
  }
}

export async function assignSessionCustomer(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
  input: AssignSessionCustomerInput,
): Promise<SessionJson> {
  assertPermission(actor, PERMISSIONS.gamingSessionsOperate);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await lockSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "OPERATE");
    if (session.status !== "ACTIVE" && session.status !== "PAUSED") {
      throw new ConflictError("Customer can only be assigned to an open session");
    }
    if (session.customerId) {
      throw new ConflictError("Session already has a customer");
    }
    await loadUsableCustomer(tx, actor.organizationId, input.customerId);
    const updated = await tx
      .update(gamingSessions)
      .set({ customerId: input.customerId })
      .where(and(eq(gamingSessions.id, sessionId), eq(gamingSessions.organizationId, actor.organizationId)))
      .returning();
    const next = updated[0]!;
    await writeOutbox(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      eventType: "gaming.session.customer_assigned",
      sessionId,
      payload: { sessionId, customerId: input.customerId, deviceId: session.currentDeviceId },
    });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: session.branchId,
      actorUserId: actor.userId,
      action: "gaming.session.customer_assigned",
      entityType: "gaming_session",
      entityId: sessionId,
      before: sessionMeta(session),
      after: sessionMeta(next),
      metadata: { customerId: input.customerId, deviceId: session.currentDeviceId },
    });
    return serializeSession(next);
  });
}
