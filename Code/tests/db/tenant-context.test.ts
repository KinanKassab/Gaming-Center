import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { createId } from "@/core/ids";
import { createMigratedPglite } from "../helpers/pglite";

function settingText(result: unknown): string {
  if (Array.isArray(result)) {
    const row = result[0] as { v?: unknown } | undefined;
    return row?.v == null ? "" : String(row.v);
  }
  if (result && typeof result === "object" && "rows" in result) {
    const row = (result as { rows: Array<{ v?: unknown }> }).rows[0];
    return row?.v == null ? "" : String(row.v);
  }
  return "";
}

describe("transaction-local tenant context", () => {
  it("clears app.organization_id after commit", async () => {
    const { db, client } = await createMigratedPglite();
    const orgId = createId();
    await client.query(
      `INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
       VALUES ($1, 'guc-a', 'GUC A', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')`,
      [orgId],
    );

    await withTenant(db, orgId, async (tx) => {
      const inside = await tx.execute(sql`select current_setting('app.organization_id', true) as v`);
      expect(settingText(inside)).toBe(orgId);
    });

    const after = await client.query<{ v: string }>(`SELECT current_setting('app.organization_id', true) AS v`);
    expect(after.rows[0]?.v ?? "").toBe("");
  });

  it("clears tenant GUC after rollback", async () => {
    const { db, client } = await createMigratedPglite();
    const orgId = createId();
    await client.query(
      `INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
       VALUES ($1, 'guc-b', 'GUC B', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')`,
      [orgId],
    );

    await expect(
      withTenant(db, orgId, async (tx) => {
        const inside = await tx.execute(sql`select current_setting('app.organization_id', true) as v`);
        expect(settingText(inside)).toBe(orgId);
        throw new Error("forced-rollback");
      }),
    ).rejects.toThrow(/forced-rollback/);

    const after = await client.query<{ v: string }>(`SELECT current_setting('app.organization_id', true) AS v`);
    expect(after.rows[0]?.v ?? "").toBe("");
  });
});
