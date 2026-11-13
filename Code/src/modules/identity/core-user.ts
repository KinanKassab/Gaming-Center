import { eq, sql } from "drizzle-orm";
import { createId } from "@/core/ids";
import { isUniqueViolation } from "@/core/errors";
import { coreUsers } from "@/db/schema";
import type { AppDatabase } from "@/db/tenant";

export const STAFF_ACCESS_PURGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PURGED_STAFF_DISPLAY_NAME = "Removed";

export type CoreUser = {
  id: string;
  authSubject: string;
  email: string | null;
  displayName: string;
  status: string;
  accessRevokedAt: Date | null;
  purgeAfter: Date | null;
};

const coreUserColumns = {
  id: coreUsers.id,
  authSubject: coreUsers.authSubject,
  email: coreUsers.email,
  displayName: coreUsers.displayName,
  status: coreUsers.status,
  accessRevokedAt: coreUsers.accessRevokedAt,
  purgeAfter: coreUsers.purgeAfter,
};

export function staffPurgeAfterFrom(revokedAt: Date): Date {
  return new Date(revokedAt.getTime() + STAFF_ACCESS_PURGE_MS);
}

export function isPurgedStaffAccount(user: {
  status: string;
  email: string | null;
  displayName: string;
}): boolean {
  return user.status === "DISABLED" && user.email === null && user.displayName === PURGED_STAFF_DISPLAY_NAME;
}

/** core_users is global identity (no RLS); reads never expose tenant data. */
export async function findCoreUserByAuthSubject(
  db: AppDatabase,
  authSubject: string,
): Promise<CoreUser | null> {
  const rows = await db
    .select(coreUserColumns)
    .from(coreUsers)
    .where(eq(coreUsers.authSubject, authSubject))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCoreUserByEmail(db: AppDatabase, email: string): Promise<CoreUser | null> {
  const rows = await db
    .select(coreUserColumns)
    .from(coreUsers)
    .where(sql`lower(${coreUsers.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Maps an authentication-provider identity to the application Core User.
 * Creates the row on first sight (a Core User row alone grants no organization
 * access — memberships do), and keeps email / display name in sync with the
 * provider afterwards. Disabled accounts are never revived from the provider.
 */
export async function ensureCoreUser(
  db: AppDatabase,
  identity: { authSubject: string; email: string | null; displayName: string },
): Promise<CoreUser> {
  const existing = await findCoreUserByAuthSubject(db, identity.authSubject);
  if (existing) {
    if (existing.status !== "ACTIVE") return existing;
    if (
      (identity.email !== null && identity.email !== existing.email) ||
      identity.displayName !== existing.displayName
    ) {
      await db
        .update(coreUsers)
        .set({ email: identity.email ?? existing.email, displayName: identity.displayName })
        .where(eq(coreUsers.id, existing.id));
      return {
        ...existing,
        email: identity.email ?? existing.email,
        displayName: identity.displayName,
      };
    }
    return existing;
  }

  const user: CoreUser = {
    id: createId(),
    authSubject: identity.authSubject,
    email: identity.email,
    displayName: identity.displayName,
    status: "ACTIVE",
    accessRevokedAt: null,
    purgeAfter: null,
  };
  try {
    await db.insert(coreUsers).values({ ...user, lastLoginAt: new Date() });
    return user;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findCoreUserByAuthSubject(db, identity.authSubject);
      if (winner) return winner;
    }
    throw error;
  }
}

/** Login-time timestamp update; a no-op when the Core User does not exist yet. */
export async function touchLastLogin(db: AppDatabase, authSubject: string): Promise<void> {
  await db
    .update(coreUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(coreUsers.authSubject, authSubject));
}

/**
 * After 30 days, drop identifying fields. Does not DELETE the row (financial
 * and session created_by foreign keys remain). Lazy: runs on authentication.
 */
export async function applyDueStaffPurge(
  db: AppDatabase,
  user: CoreUser,
  now = new Date(),
): Promise<CoreUser> {
  if (user.status !== "DISABLED") return user;
  if (!user.purgeAfter || user.purgeAfter > now) return user;
  if (isPurgedStaffAccount(user)) return user;

  await db
    .update(coreUsers)
    .set({
      email: null,
      displayName: PURGED_STAFF_DISPLAY_NAME,
    })
    .where(eq(coreUsers.id, user.id));

  return {
    ...user,
    email: null,
    displayName: PURGED_STAFF_DISPLAY_NAME,
  };
}
