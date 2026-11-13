import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";

export type { AppDatabase } from "@/db/client";

export type TenantContext = {
  /** Selected organization. Optional only for pre-selection user queries. */
  organizationId?: string;
  /** Authenticated core user. Lets RLS expose the user's own membership rows. */
  userId?: string;
};

/**
 * Transaction-local tenant context. Uses set_config(..., is_local=true)
 * so pooled connections cannot leak organization_id / user_id to the next
 * request. There is no RLS bypass GUC: tenant policies have no skip path
 * the runtime role can enable.
 */
export async function withTenant<T>(
  db: AppDatabase,
  context: string | TenantContext,
  fn: (tx: AppDatabase) => Promise<T>,
): Promise<T> {
  const ctx: TenantContext = typeof context === "string" ? { organizationId: context } : context;
  if (!ctx.organizationId && !ctx.userId) {
    throw new Error("withTenant requires an organizationId or a userId");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.organization_id', ${ctx.organizationId ?? ""}, true)`);
    await tx.execute(sql`select set_config('app.user_id', ${ctx.userId ?? ""}, true)`);
    return fn(tx as AppDatabase);
  });
}

/**
 * Public customer statement. Sets only the portal token.
 * Row visibility is the portal SELECT policy; organization_id stays empty.
 */
export async function withPortalToken<T>(
  db: AppDatabase,
  portalToken: string,
  fn: (tx: AppDatabase) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.organization_id', '', true)`);
    await tx.execute(sql`select set_config('app.user_id', '', true)`);
    await tx.execute(sql`select set_config('app.portal_token', ${portalToken}, true)`);
    return fn(tx as AppDatabase);
  });
}
