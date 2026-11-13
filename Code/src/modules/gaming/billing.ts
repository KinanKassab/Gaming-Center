import { and, eq, isNull, sql } from "drizzle-orm";
import { BillingError, ConflictError, NotFoundError } from "@/core/errors";
import { parseMinorUnits } from "@/core/money";
import { assertPermission } from "@/core/tenancy";
import {
  coreBranches,
  coreOutboxEvents,
  gamingSessionPauses,
  gamingSessionSegments,
  gamingSessions,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { createId } from "@/core/ids";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { requireBranchAccess } from "./access";
import {
  calculateSessionBilling,
  type BillingPauseFact,
  type BillingResult,
  type BillingSegmentFact,
  type SessionBillingFacts,
} from "./billing-calculator";

export type SessionBillingStatus = "PROVISIONAL" | "FINALIZED" | "UNFINALIZED" | "NOT_ELIGIBLE";

export type SessionBillingView = {
  sessionId: string;
  status: SessionBillingStatus;
  reason: string | null;
  finalized: boolean;
  result: BillingResult | null;
  error: string | null;
};

async function transactionNow(tx: AppDatabase): Promise<Date> {
  const rows = await tx.select({ now: sql<Date>`now()` }).from(coreBranches).limit(1);
  const value = rows[0]?.now;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

async function loadSession(
  tx: AppDatabase,
  organizationId: string,
  sessionId: string,
): Promise<typeof gamingSessions.$inferSelect> {
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
): Promise<typeof gamingSessions.$inferSelect> {
  await tx.execute(
    sql`select id from gaming_sessions where id = ${sessionId} and organization_id = ${organizationId} for update`,
  );
  return loadSession(tx, organizationId, sessionId);
}

async function loadFacts(
  tx: AppDatabase,
  sessionId: string,
): Promise<{ segments: BillingSegmentFact[]; pauses: BillingPauseFact[] }> {
  const segmentRows = await tx
    .select()
    .from(gamingSessionSegments)
    .where(eq(gamingSessionSegments.sessionId, sessionId));
  const pauseRows = await tx
    .select()
    .from(gamingSessionPauses)
    .where(eq(gamingSessionPauses.sessionId, sessionId));
  return {
    segments: segmentRows.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      pricingPlanId: row.pricingPlanId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      pricingSnapshot: row.pricingSnapshot,
      computedAmountMinor: row.computedAmountMinor,
    })),
    pauses: pauseRows.map((row) => ({
      id: row.id,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      isBillable: row.isBillable,
    })),
  };
}

function viewFromStored(session: typeof gamingSessions.$inferSelect): SessionBillingView | null {
  if (session.billingFinalizedAt == null || session.billingBreakdown == null || session.gamingTotalMinor == null) {
    return null;
  }
  const stored = session.billingBreakdown as BillingResult;
  return {
    sessionId: session.id,
    status: "FINALIZED",
    reason: null,
    finalized: true,
    result: {
      ...stored,
      totalMinor: session.gamingTotalMinor.toString(),
      currency: session.billingCurrency ?? stored.currency,
      ruleVersion: session.billingRuleVersion ?? stored.ruleVersion,
      calculatedAt:
        stored.calculatedAt ??
        (session.billingFinalizedAt instanceof Date
          ? session.billingFinalizedAt.toISOString()
          : String(session.billingFinalizedAt)),
    },
    error: null,
  };
}

function ineligible(sessionId: string, reason: string): SessionBillingView {
  return {
    sessionId,
    status: "NOT_ELIGIBLE",
    reason,
    finalized: false,
    result: null,
    error: null,
  };
}

async function writeBillingArtifacts(
  tx: AppDatabase,
  actor: OrganizationActor,
  session: typeof gamingSessions.$inferSelect,
  result: BillingResult,
  calculatedAt: Date,
): Promise<BillingResult> {
  const total = parseMinorUnits(result.totalMinor);
  for (const line of result.segments) {
    const amount = parseMinorUnits(line.amountMinor);
    const current = await tx
      .select({
        id: gamingSessionSegments.id,
        computedAmountMinor: gamingSessionSegments.computedAmountMinor,
      })
      .from(gamingSessionSegments)
      .where(
        and(
          eq(gamingSessionSegments.id, line.segmentId),
          eq(gamingSessionSegments.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    const row = current[0];
    if (!row) {
      throw new BillingError("Billing segment is missing from the session");
    }
    if (row.computedAmountMinor != null && row.computedAmountMinor !== amount) {
      throw new BillingError("Stored segment amount does not match snapshot calculation");
    }
    if (row.computedAmountMinor == null) {
      await tx
        .update(gamingSessionSegments)
        .set({ computedAmountMinor: amount })
        .where(
          and(
            eq(gamingSessionSegments.id, line.segmentId),
            eq(gamingSessionSegments.organizationId, actor.organizationId),
          ),
        );
    }
  }

  const updated = await tx
    .update(gamingSessions)
    .set({
      gamingTotalMinor: total,
      billingFinalizedAt: calculatedAt,
      billingRuleVersion: result.ruleVersion,
      billingCurrency: result.currency,
      billingBreakdown: result,
    })
    .where(
      and(
        eq(gamingSessions.id, session.id),
        eq(gamingSessions.organizationId, actor.organizationId),
        isNull(gamingSessions.billingFinalizedAt),
      ),
    )
    .returning();

  if (updated.length === 0) {
    const current = await loadSession(tx, actor.organizationId, session.id);
    const stored = viewFromStored(current);
    if (stored?.result) return stored.result;
    throw new ConflictError("Session billing was finalized concurrently");
  }

  await tx.insert(coreOutboxEvents).values({
    id: createId(),
    organizationId: actor.organizationId,
    branchId: session.branchId,
    eventType: "gaming.session.billing_finalized",
    aggregateType: "gaming_session",
    aggregateId: session.id,
    payload: {
      sessionId: session.id,
      totalMinor: result.totalMinor,
      currency: result.currency,
      ruleVersion: result.ruleVersion,
      finalizedAt: calculatedAt.toISOString(),
    },
  });
  await recordAudit(tx, {
    organizationId: actor.organizationId,
    branchId: session.branchId,
    actorUserId: actor.userId,
    action: "gaming.session.billing_finalized",
    entityType: "gaming_session",
    entityId: session.id,
    before: {
      status: session.status,
      gamingTotalMinor: session.gamingTotalMinor == null ? null : session.gamingTotalMinor.toString(),
      billingFinalizedAt: null,
    },
    after: {
      status: "COMPLETED",
      gamingTotalMinor: result.totalMinor,
      currency: result.currency,
      ruleVersion: result.ruleVersion,
      billingFinalizedAt: calculatedAt.toISOString(),
    },
    metadata: {
      sessionId: session.id,
      totalMinor: result.totalMinor,
      currency: result.currency,
      billableSeconds: result.billableSeconds,
    },
  });
  return result;
}

/**
 * Persist a canonical bill for a COMPLETED session already in `tx`.
 * Returns the result, or null when calculation fails (caller may still complete
 * the operational close). Throws when the session is not eligible.
 */
export async function persistBillingInTransaction(
  tx: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
  calculatedAt: Date,
): Promise<BillingResult | null> {
  const session = await lockSession(tx, actor.organizationId, sessionId);
  if (session.status !== "COMPLETED") {
    throw new BillingError("Only a COMPLETED session can be billed");
  }
  const existing = viewFromStored(session);
  if (existing?.result) return existing.result;

  const facts = await loadFacts(tx, sessionId);
  let result: BillingResult;
  try {
    result = calculateSessionBilling({
      sessionId,
      sessionStatus: session.status,
      segments: facts.segments,
      pauses: facts.pauses,
      asOf: calculatedAt,
      mode: "final",
    } satisfies SessionBillingFacts);
  } catch (error) {
    if (error instanceof BillingError) return null;
    throw error;
  }
  return writeBillingArtifacts(tx, actor, session, result, calculatedAt);
}

export async function getSessionBilling(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
): Promise<SessionBillingView> {
  assertPermission(actor, PERMISSIONS.gamingSessionsRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await loadSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "VIEW");
    if (session.status === "CANCELLED") {
      return ineligible(sessionId, "CANCELLED_SESSION");
    }
    const stored = viewFromStored(session);
    if (stored) return stored;

    const now = await transactionNow(tx);
    const facts = await loadFacts(tx, sessionId);
    const open = session.status === "ACTIVE" || session.status === "PAUSED" || session.status === "ENDING";
    try {
      const result = calculateSessionBilling({
        sessionId,
        sessionStatus: session.status,
        segments: facts.segments,
        pauses: facts.pauses,
        asOf: now,
        mode: open ? "provisional" : "final",
      });
      if (open) {
        return {
          sessionId,
          status: "PROVISIONAL",
          reason: "OPEN_SESSION",
          finalized: false,
          result,
          error: null,
        };
      }
      return {
        sessionId,
        status: "UNFINALIZED",
        reason: "AWAITING_FINALIZATION",
        finalized: false,
        result,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing calculation failed";
      if (open) {
        return {
          sessionId,
          status: "PROVISIONAL",
          reason: "OPEN_SESSION",
          finalized: false,
          result: null,
          error: message,
        };
      }
      return {
        sessionId,
        status: "UNFINALIZED",
        reason: "CALCULATION_FAILED",
        finalized: false,
        result: null,
        error: message,
      };
    }
  });
}

export async function finalizeSessionBilling(
  db: AppDatabase,
  actor: OrganizationActor,
  sessionId: string,
): Promise<SessionBillingView> {
  assertPermission(actor, PERMISSIONS.gamingSessionsOperate);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const session = await lockSession(tx, actor.organizationId, sessionId);
    requireBranchAccess(actor, session.branchId, "OPERATE");
    if (session.status === "CANCELLED") {
      throw new BillingError("Cancelled sessions are not billed");
    }
    if (session.status !== "COMPLETED") {
      throw new BillingError("Only a COMPLETED session can be billed");
    }
    const stored = viewFromStored(session);
    if (stored) return stored;

    const now = await transactionNow(tx);
    const facts = await loadFacts(tx, sessionId);
    const result = calculateSessionBilling({
      sessionId,
      sessionStatus: session.status,
      segments: facts.segments,
      pauses: facts.pauses,
      asOf: now,
      mode: "final",
    });
    const persisted = await writeBillingArtifacts(tx, actor, session, result, now);
    return {
      sessionId,
      status: "FINALIZED",
      reason: null,
      finalized: true,
      result: persisted,
      error: null,
    };
  });
}
