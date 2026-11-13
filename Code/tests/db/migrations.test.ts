import { describe, expect, it } from "vitest";
import { createId } from "@/core/ids";
import { createMigratedPglite } from "../helpers/pglite";

describe("migrations", () => {
  it("applies all migrations on an empty database", async () => {
    const { client } = await createMigratedPglite();
    const result = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname = 'core_organizations' AND relkind = 'r'`,
    );
    expect(result.rows[0]?.relname).toBe("core_organizations");

    const cards = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE 'cards_%'`,
    );
    expect(cards.rows).toEqual([]);

    const permissions = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM core_permissions`);
    expect(Number(permissions.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("creates the auth provider tables and identity columns (0002)", async () => {
    const { client } = await createMigratedPglite();

    const authTables = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE 'auth_%' AND relkind = 'r' ORDER BY relname`,
    );
    expect(authTables.rows.map((row) => row.relname)).toEqual([
      "auth_accounts",
      "auth_sessions",
      "auth_users",
      "auth_verifications",
    ]);

    const columns = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name = 'core_users' AND column_name = 'last_login_at')
          OR (table_name = 'core_organization_memberships' AND column_name = 'joined_at')`,
    );
    expect(columns.rows).toHaveLength(2);

    const readPermissions = await client.query<{ code: string }>(
      `SELECT code FROM core_permissions WHERE code IN ('core.memberships.read', 'core.roles.read') ORDER BY code`,
    );
    expect(readPermissions.rows.map((row) => row.code)).toEqual([
      "core.memberships.read",
      "core.roles.read",
    ]);

    // Refined RLS: per-command policies exist on memberships and organizations.
    const policies = await client.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname FROM pg_policies
       WHERE tablename IN ('core_organization_memberships', 'core_organizations')`,
    );
    expect(policies.rows.length).toBeGreaterThanOrEqual(8);
  });

  it("applies security hardening (0003): no bypass function, uniqueness, membership invariants", async () => {
    const { client } = await createMigratedPglite();

    const bypass = await client.query<{ proname: string }>(
      `SELECT proname FROM pg_proc WHERE proname = 'app_bypass_rls'`,
    );
    expect(bypass.rows).toEqual([]);

    const emailIndex = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'core_users_email_lower_key'`,
    );
    expect(emailIndex.rows).toHaveLength(1);

    const accountIndex = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'auth_accounts_issuer_account_id_key'`,
    );
    expect(accountIndex.rows).toHaveLength(1);

    const trigger = await client.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_core_organization_memberships_invariants'`,
    );
    expect(trigger.rows).toHaveLength(1);

    const selfPolicy = await client.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies
       WHERE tablename = 'core_organization_memberships'
         AND policyname = 'core_organization_memberships_update_self'`,
    );
    expect(selfPolicy.rows).toHaveLength(1);
  });

  it("applies runtime role enforcement (0004): gaming_app is restricted", async () => {
    const { client } = await createMigratedPglite();
    const role = await client.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
       FROM pg_roles WHERE rolname = 'gaming_app'`,
    );
    expect(role.rows[0]).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolcanlogin: true,
    });
  });

  it("applies configuration and customer hardening (0005)", async () => {
    const { client } = await createMigratedPglite();
    const permission = await client.query<{ code: string }>(
      `SELECT code FROM core_permissions WHERE code = 'core.settings.read'`,
    );
    expect(permission.rows.map((row) => row.code)).toEqual(["core.settings.read"]);

    const emailIndex = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'core_customers_org_email_idx'`,
    );
    expect(emailIndex.rows).toHaveLength(1);

    const customerTrigger = await client.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_core_customers_invariants'`,
    );
    expect(customerTrigger.rows).toHaveLength(1);

    const settingTrigger = await client.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_core_setting_values_invariants'`,
    );
    expect(settingTrigger.rows).toHaveLength(1);
  });

  it("applies gaming master data (0006): tables, permissions, RLS, no cards", async () => {
    const { client } = await createMigratedPglite();
    const tables = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relkind = 'r' AND relname IN (
         'gaming_areas', 'gaming_device_types', 'gaming_devices',
         'gaming_pricing_plans', 'gaming_pricing_assignments'
       )
       ORDER BY relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual([
      "gaming_areas",
      "gaming_device_types",
      "gaming_devices",
      "gaming_pricing_assignments",
      "gaming_pricing_plans",
    ]);

    const permissions = await client.query<{ code: string }>(
      `SELECT code FROM core_permissions WHERE code LIKE 'gaming.master.%' ORDER BY code`,
    );
    expect(permissions.rows.map((row) => row.code)).toEqual(["gaming.master.manage", "gaming.master.read"]);

    const rls = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       WHERE c.relname IN ('gaming_areas', 'gaming_devices')
       ORDER BY c.relname`,
    );
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const bypass = await client.query<{ proname: string }>(
      `SELECT proname FROM pg_proc WHERE proname = 'app_bypass_rls'`,
    );
    expect(bypass.rows).toEqual([]);

    const cards = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE 'cards_%'`,
    );
    expect(cards.rows).toEqual([]);
  });

  it("applies gaming sessions (0007): tables, occupancy index, permissions, RLS, no delete grant requirement", async () => {
    const { client } = await createMigratedPglite();
    const tables = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relkind = 'r' AND relname IN (
         'gaming_sessions', 'gaming_session_segments', 'gaming_session_pauses'
       )
       ORDER BY relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual([
      "gaming_session_pauses",
      "gaming_session_segments",
      "gaming_sessions",
    ]);

    const occupancy = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_gaming_sessions_one_active_per_device'`,
    );
    expect(occupancy.rows).toHaveLength(1);

    const permissions = await client.query<{ code: string }>(
      `SELECT code FROM core_permissions WHERE code LIKE 'gaming.sessions.%' ORDER BY code`,
    );
    expect(permissions.rows.map((row) => row.code)).toEqual([
      "gaming.sessions.cancel",
      "gaming.sessions.operate",
      "gaming.sessions.read",
      "gaming.sessions.start",
    ]);

    const rls = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       WHERE c.relname IN ('gaming_sessions', 'gaming_session_segments', 'gaming_session_pauses')
       ORDER BY c.relname`,
    );
    expect(rls.rows).toHaveLength(3);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const bypass = await client.query<{ proname: string }>(
      `SELECT proname FROM pg_proc WHERE proname = 'app_bypass_rls'`,
    );
    expect(bypass.rows).toEqual([]);
  });

  it("applies gaming billing (0008): finalized-shape columns and one-time fill", async () => {
    const { client } = await createMigratedPglite();
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'gaming_sessions'
         AND column_name IN ('billing_finalized_at', 'billing_rule_version', 'billing_currency', 'billing_breakdown')
       ORDER BY column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "billing_breakdown",
      "billing_currency",
      "billing_finalized_at",
      "billing_rule_version",
    ]);
  });

  it("applies finance checkout (0009): tables, permissions, RLS, no runtime DELETE on history", async () => {
    const { client } = await createMigratedPglite();
    const tables = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relkind = 'r' AND relname IN (
         'finance_payment_methods', 'finance_charges', 'finance_charge_items',
         'finance_payments', 'finance_payment_allocations'
       )
       ORDER BY relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual([
      "finance_charge_items",
      "finance_charges",
      "finance_payment_allocations",
      "finance_payment_methods",
      "finance_payments",
    ]);

    const permissions = await client.query<{ code: string }>(
      `SELECT code FROM core_permissions WHERE code LIKE 'finance.payments.%' ORDER BY code`,
    );
    expect(permissions.rows.map((row) => row.code)).toEqual([
      "finance.payments.create",
      "finance.payments.read",
    ]);

    const rls = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       WHERE c.relname IN (
         'finance_payment_methods', 'finance_charges', 'finance_charge_items',
         'finance_payments', 'finance_payment_allocations'
       )`,
    );
    expect(rls.rows).toHaveLength(5);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const cards = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname LIKE 'cards_%'`,
    );
    expect(cards.rows).toEqual([]);
  });

  it("applies finance expenses (0015): tables, permissions, RLS, no cash_shift_id", async () => {
    const { client } = await createMigratedPglite();
    const tables = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relkind = 'r' AND relname IN ('finance_expense_categories', 'finance_expenses')
       ORDER BY relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual([
      "finance_expense_categories",
      "finance_expenses",
    ]);

    const shiftColumn = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'finance_expenses' AND column_name = 'cash_shift_id'`,
    );
    expect(shiftColumn.rows).toEqual([]);

    const permissions = await client.query<{ code: string }>(
      `SELECT code FROM core_permissions WHERE code LIKE 'finance.expenses.%' ORDER BY code`,
    );
    expect(permissions.rows.map((row) => row.code)).toEqual([
      "finance.expenses.create",
      "finance.expenses.read",
    ]);

    const rls = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       WHERE c.relname IN ('finance_expense_categories', 'finance_expenses')
       ORDER BY c.relname`,
    );
    expect(rls.rows).toHaveLength(2);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const deleteGrant = await client.query<{ expenses: boolean; categories: boolean }>(
      `SELECT
         has_table_privilege('gaming_app', 'finance_expenses', 'DELETE') AS expenses,
         has_table_privilege('gaming_app', 'finance_expense_categories', 'DELETE') AS categories`,
    );
    expect(deleteGrant.rows[0]?.expenses).toBe(false);
    expect(deleteGrant.rows[0]?.categories).toBe(false);
  });

  it("applies pilot hardening (0010): runtime DELETE revoked on audit and archive-only masters", async () => {
    const { client } = await createMigratedPglite();
    const privileges = await client.query<{
      audit: boolean;
      auditUpdate: boolean;
      customers: boolean;
      devices: boolean;
      settings: boolean;
      sessions: boolean;
    }>(
      `SELECT
         has_table_privilege('gaming_app', 'core_audit_logs', 'DELETE') AS audit,
         has_table_privilege('gaming_app', 'core_audit_logs', 'UPDATE') AS "auditUpdate",
         has_table_privilege('gaming_app', 'core_customers', 'DELETE') AS customers,
         has_table_privilege('gaming_app', 'gaming_devices', 'DELETE') AS devices,
         has_table_privilege('gaming_app', 'core_setting_values', 'DELETE') AS settings,
         has_table_privilege('gaming_app', 'gaming_sessions', 'DELETE') AS sessions`,
    );
    expect(privileges.rows[0]?.audit).toBe(false);
    expect(privileges.rows[0]?.auditUpdate).toBe(false);
    expect(privileges.rows[0]?.customers).toBe(false);
    expect(privileges.rows[0]?.devices).toBe(false);
    expect(privileges.rows[0]?.sessions).toBe(false);
    expect(privileges.rows[0]?.settings).toBe(true);
  });

  it("adds staff revoke timestamps (0016) without deleting core_users", async () => {
    const { client } = await createMigratedPglite();
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'core_users' AND column_name IN ('access_revoked_at', 'purge_after')
       ORDER BY column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(["access_revoked_at", "purge_after"]);
  });

  it("applies supabase platform hardening (0011) without requiring anon roles", async () => {
    const { client } = await createMigratedPglite();
    const applied = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname = 'core_organizations' AND relkind = 'r'`,
    );
    expect(applied.rows[0]?.relname).toBe("core_organizations");
    const anon = await client.query<{ rolname: string }>(`SELECT rolname FROM pg_roles WHERE rolname = 'anon'`);
    expect(anon.rows).toEqual([]);
    const stillRuntime = await client.query<{ ok: boolean }>(
      `SELECT has_table_privilege('gaming_app', 'core_organizations', 'SELECT') AS ok`,
    );
    expect(stillRuntime.rows[0]?.ok).toBe(true);
  });

  it("applies platform bootstrap (0012): singleton, no RLS, runtime cannot INSERT/DELETE", async () => {
    const { client } = await createMigratedPglite();
    const table = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity
       FROM pg_class c
       WHERE c.relname = 'core_platform_bootstrap' AND c.relkind = 'r'`,
    );
    expect(table.rows[0]?.relname).toBe("core_platform_bootstrap");
    expect(table.rows[0]?.relrowsecurity).toBe(false);

    const rows = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM core_platform_bootstrap`);
    expect(rows.rows[0]?.n).toBe("1");

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'core_platform_bootstrap'
       ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "singleton",
      "signup_claimed_at",
      "first_core_user_id",
      "first_organization_id",
      "created_at",
    ]);

    const privileges = await client.query<{
      sel: boolean;
      upd: boolean;
      ins: boolean;
      del: boolean;
    }>(
      `SELECT
         has_table_privilege('gaming_app', 'core_platform_bootstrap', 'SELECT') AS sel,
         has_table_privilege('gaming_app', 'core_platform_bootstrap', 'UPDATE') AS upd,
         has_table_privilege('gaming_app', 'core_platform_bootstrap', 'INSERT') AS ins,
         has_table_privilege('gaming_app', 'core_platform_bootstrap', 'DELETE') AS del`,
    );
    expect(privileges.rows[0]?.sel).toBe(true);
    expect(privileges.rows[0]?.upd).toBe(true);
    expect(privileges.rows[0]?.ins).toBe(false);
    expect(privileges.rows[0]?.del).toBe(false);
  });

  it("adds time_billing_mode UNIT default (0013) without rewriting 0001–0012", async () => {
    const { client } = await createMigratedPglite();
    const column = await client.query<{ column_name: string; column_default: string | null }>(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'gaming_pricing_plans' AND column_name = 'time_billing_mode'`,
    );
    expect(column.rows).toHaveLength(1);
    expect(column.rows[0]?.column_default).toMatch(/UNIT/);

    const checks = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'gaming_pricing_plans'::regclass
         AND conname IN (
           'gaming_pricing_plans_time_billing_mode_chk',
           'gaming_pricing_plans_time_billing_model_chk'
         )
       ORDER BY conname`,
    );
    expect(checks.rows.map((row) => row.conname)).toEqual([
      "gaming_pricing_plans_time_billing_mode_chk",
      "gaming_pricing_plans_time_billing_model_chk",
    ]);

    const rls = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c WHERE c.relname = 'gaming_pricing_plans'`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    expect(rls.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it("enforces unique normalized branch names per organization (0014)", async () => {
    const { client } = await createMigratedPglite();
    const index = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'core_branches_org_name_normalized_key'`,
    );
    expect(index.rows).toHaveLength(1);

    const orgA = createId();
    const orgB = createId();
    await client.query(
      `INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
       VALUES ($1, 'org-a', 'Org A', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')`,
      [orgA],
    );
    await client.query(
      `INSERT INTO core_organizations (id, slug, name, status, default_currency, timezone, locale)
       VALUES ($1, 'org-b', 'Org B', 'ACTIVE', 'SYP', 'Asia/Damascus', 'ar')`,
      [orgB],
    );
    await client.query(
      `INSERT INTO core_branches (id, organization_id, code, name, status)
       VALUES ($1, $2, 'A1', 'Jaramana', 'ACTIVE')`,
      [createId(), orgA],
    );
    await expect(
      client.query(
        `INSERT INTO core_branches (id, organization_id, code, name, status)
         VALUES ($1, $2, 'A2', ' Jaramana ', 'ACTIVE')`,
        [createId(), orgA],
      ),
    ).rejects.toThrow(/core_branches_org_name_normalized_key|duplicate key/i);
    await expect(
      client.query(
        `INSERT INTO core_branches (id, organization_id, code, name, status)
         VALUES ($1, $2, 'A3', 'jaramana', 'ARCHIVED')`,
        [createId(), orgA],
      ),
    ).rejects.toThrow();
    await client.query(
      `INSERT INTO core_branches (id, organization_id, code, name, status)
       VALUES ($1, $2, 'B1', 'Jaramana', 'ACTIVE')`,
      [createId(), orgB],
    );

    const race = await Promise.allSettled([
      client.query(
        `INSERT INTO core_branches (id, organization_id, code, name, status)
         VALUES ($1, $2, 'R1', 'Race', 'ACTIVE')`,
        [createId(), orgA],
      ),
      client.query(
        `INSERT INTO core_branches (id, organization_id, code, name, status)
         VALUES ($1, $2, 'R2', 'race', 'ACTIVE')`,
        [createId(), orgA],
      ),
    ]);
    expect(race.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((row) => row.status === "rejected")).toHaveLength(1);

    await client.query(
      `INSERT INTO core_branches (id, organization_id, code, name, status)
       VALUES ($1, $2, 'C1', 'Unique One', 'ACTIVE')`,
      [createId(), orgA],
    );
    await expect(
      client.query(
        `INSERT INTO core_branches (id, organization_id, code, name, status)
         VALUES ($1, $2, 'C1', 'Unique Two', 'ACTIVE')`,
        [createId(), orgA],
      ),
    ).rejects.toThrow(/core_branches_org_code_key|duplicate key/i);
  });

  it("rejects duplicate auth_subject mappings at the database level", async () => {
    const { client } = await createMigratedPglite();
    const subject = "provider-subject-1";
    await client.query(
      `INSERT INTO core_users (id, auth_subject, display_name, status) VALUES ($1, $2, 'One', 'ACTIVE')`,
      [createId(), subject],
    );
    await expect(
      client.query(
        `INSERT INTO core_users (id, auth_subject, display_name, status) VALUES ($1, $2, 'Two', 'ACTIVE')`,
        [createId(), subject],
      ),
    ).rejects.toThrow();
  });

  it("adds the customer portal token and append-only ledger (0017)", async () => {
    const { client } = await createMigratedPglite();
    const column = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'core_customers' AND column_name = 'portal_token'`,
    );
    expect(column.rows).toHaveLength(1);
    const table = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname = 'finance_customer_ledger_entries' AND relkind = 'r'`,
    );
    expect(table.rows).toHaveLength(1);
    const policy = await client.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE policyname = 'finance_customer_ledger_portal_select'`,
    );
    expect(policy.rows).toHaveLength(1);
  });

  it("adds POS catalog and session order links (0018)", async () => {
    const { client } = await createMigratedPglite();
    for (const relname of [
      "catalog_products",
      "catalog_product_prices",
      "pos_orders",
      "pos_order_items",
      "gaming_session_order_links",
    ]) {
      const table = await client.query<{ relname: string }>(
        `SELECT relname FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
        [relname],
      );
      expect(table.rows).toHaveLength(1);
    }
    const perm = await client.query<{ code: string }>(
      `SELECT code FROM core_permissions WHERE code = 'pos.orders.create'`,
    );
    expect(perm.rows).toHaveLength(1);
  });
});
