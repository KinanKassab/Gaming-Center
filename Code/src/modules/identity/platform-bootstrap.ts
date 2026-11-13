import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, isNull } from "drizzle-orm";
import { ConflictError } from "@/core/errors";
import { corePlatformBootstrap, coreUsers } from "@/db/schema";
import type { AppDatabase } from "@/db/tenant";
import { findCoreUserByAuthSubject } from "@/modules/identity/core-user";

const platformOrganizationClaim = new AsyncLocalStorage<boolean>();

/** HTTP POST /api/organizations runs inside this so a second tenant cannot be created. */
export function runWithPlatformOrganizationClaim<T>(fn: () => T): T {
  return platformOrganizationClaim.run(true, fn);
}

export function isPlatformOrganizationClaimRequired(): boolean {
  return platformOrganizationClaim.getStore() === true;
}

export async function hasAnyCoreUser(db: AppDatabase): Promise<boolean> {
  const rows = await db.select({ id: coreUsers.id }).from(coreUsers).limit(1);
  return rows.length > 0;
}

export async function isFirstUserRequired(db: AppDatabase): Promise<boolean> {
  return !(await hasAnyCoreUser(db));
}

export async function readPlatformBootstrap(db: AppDatabase) {
  const rows = await db
    .select({
      signupClaimedAt: corePlatformBootstrap.signupClaimedAt,
      firstCoreUserId: corePlatformBootstrap.firstCoreUserId,
      firstOrganizationId: corePlatformBootstrap.firstOrganizationId,
    })
    .from(corePlatformBootstrap)
    .where(eq(corePlatformBootstrap.singleton, true))
    .limit(1);
  return rows[0] ?? null;
}

export async function assertInitialOrganizationCreateAllowed(db: AppDatabase): Promise<void> {
  const row = await readPlatformBootstrap(db);
  if (row?.firstOrganizationId) {
    throw new ConflictError("The initial organization has already been created");
  }
}

/**
 * Transaction-scoped claim. One winner per deployment. Compatible with
 * transaction pooling: the UPDATE locks the singleton row only for this
 * transaction, then releases on commit/rollback.
 */
export async function recordInitialOrganizationId(
  tx: AppDatabase,
  organizationId: string,
): Promise<void> {
  await tx
    .update(corePlatformBootstrap)
    .set({ firstOrganizationId: organizationId })
    .where(and(eq(corePlatformBootstrap.singleton, true), isNull(corePlatformBootstrap.firstOrganizationId)));

  if (!isPlatformOrganizationClaimRequired()) return;

  const row = await readPlatformBootstrap(tx);
  if (row?.firstOrganizationId !== organizationId) {
    throw new ConflictError("The initial organization has already been created");
  }
}

/**
 * Atomically claims the HTTP first-user slot. Returns false when identities
 * already exist or another request won the claim.
 */
export async function claimHttpSignupSlot(db: AppDatabase): Promise<boolean> {
  if (await hasAnyCoreUser(db)) return false;
  const updated = await db
    .update(corePlatformBootstrap)
    .set({ signupClaimedAt: new Date() })
    .where(
      and(
        eq(corePlatformBootstrap.singleton, true),
        isNull(corePlatformBootstrap.signupClaimedAt),
        isNull(corePlatformBootstrap.firstCoreUserId),
      ),
    )
    .returning();
  return updated.length === 1;
}

export async function releaseHttpSignupClaim(db: AppDatabase): Promise<void> {
  await db
    .update(corePlatformBootstrap)
    .set({ signupClaimedAt: null })
    .where(
      and(
        eq(corePlatformBootstrap.singleton, true),
        isNull(corePlatformBootstrap.firstCoreUserId),
      ),
    );
}

export async function completeHttpSignupClaim(db: AppDatabase, response: Response): Promise<void> {
  let authSubject: string | undefined;
  try {
    const payload = (await response.clone().json()) as { user?: { id?: unknown } };
    if (typeof payload.user?.id === "string") authSubject = payload.user.id;
  } catch {
    authSubject = undefined;
  }

  if (authSubject) {
    const user = await findCoreUserByAuthSubject(db, authSubject);
    if (user) {
      await db
        .update(corePlatformBootstrap)
        .set({ firstCoreUserId: user.id })
        .where(eq(corePlatformBootstrap.singleton, true));
      return;
    }
  }

  const users = await db.select({ id: coreUsers.id }).from(coreUsers).limit(2);
  if (users.length === 1) {
    await db
      .update(corePlatformBootstrap)
      .set({ firstCoreUserId: users[0]!.id })
      .where(eq(corePlatformBootstrap.singleton, true));
  }
}
