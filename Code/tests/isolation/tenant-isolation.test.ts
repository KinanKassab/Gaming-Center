import { describe, expect, it } from "vitest";
import { createId } from "@/core/ids";
import { resolveOrganizationId } from "@/core/tenancy";
import { TenantIsolationError } from "@/core/errors";
import { withTenant } from "@/db/tenant";
import { coreCustomers } from "@/db/schema";
import { createMigratedPglite } from "../helpers/pglite";
import { requireGamingAppRole } from "../helpers/identity";
import type { PGlite } from "@electric-sql/pglite";

async function seedTwoOrganizations(client: PGlite) {
  const orgA = createId();
  const orgB = createId();
  const branchA = createId();
  const branchB = createId();

  // Seed as the engine's privileged role (PGlite superuser / table owner).
  // There is no app.bypass_rls skip path.

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
     VALUES ($1, $2, 'A1', 'Branch A', 'ACTIVE')`,
    [branchA, orgA],
  );
  await client.query(
    `INSERT INTO core_branches (id, organization_id, code, name, status)
     VALUES ($1, $2, 'B1', 'Branch B', 'ACTIVE')`,
    [branchB, orgB],
  );
  await client.query(
    `INSERT INTO core_customers (id, organization_id, display_name, status, portal_token, created_branch_id)
     VALUES ($1, $2, 'Customer A', 'ACTIVE', gen_random_uuid(), $3)`,
    [createId(), orgA, branchA],
  );
  await client.query(
    `INSERT INTO core_customers (id, organization_id, display_name, status, portal_token, created_branch_id)
     VALUES ($1, $2, 'Customer B', 'ACTIVE', gen_random_uuid(), $3)`,
    [createId(), orgB, branchB],
  );

  return { orgA, orgB, branchA, branchB };
}

describe("tenant isolation", () => {
  it("rejects a client organization id that does not match the session", () => {
    const session = {
      userId: "u1",
      organizationId: "org-a",
      branchAccess: [],
      permissions: [],
    };
    expect(() => resolveOrganizationId(session, "org-b")).toThrow(TenantIsolationError);
  });

  it("rejects a customer whose created_branch belongs to another organization", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, branchB } = await seedTwoOrganizations(client);

    await expect(
      client.query(
        `INSERT INTO core_customers (id, organization_id, display_name, status, portal_token, created_branch_id)
         VALUES ($1, $2, 'Cross', 'ACTIVE', gen_random_uuid(), $3)`,
        [createId(), orgA, branchB],
      ),
    ).rejects.toThrow();
  });

  it("hides other organizations from the application role when RLS applies", async () => {
    const { client } = await createMigratedPglite();
    const { orgA } = await seedTwoOrganizations(client);

    await requireGamingAppRole(client);
    await client.query(`SET ROLE gaming_app`);
    await client.query(`SELECT set_config('app.organization_id', $1, false)`, [orgA]);

    const visible = await client.query<{ display_name: string }>(
      `SELECT display_name FROM core_customers ORDER BY display_name`,
    );
    expect(visible.rows.map((row) => row.display_name)).toEqual(["Customer A"]);
  });

  it("withTenant scopes drizzle queries when RLS applies", async () => {
    const { client, db } = await createMigratedPglite();
    const { orgA } = await seedTwoOrganizations(client);

    await requireGamingAppRole(client);
    await client.query(`SET ROLE gaming_app`);
    const rows = await withTenant(db, orgA, async (tx) => tx.select().from(coreCustomers));
    expect(rows.map((row) => row.displayName).sort()).toEqual(["Customer A"]);
  });

  it("hides other organizations' setting values under RLS", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, orgB } = await seedTwoOrganizations(client);
    await client.query(
      `INSERT INTO core_setting_values (id, organization_id, setting_key, scope, scope_id, value)
       VALUES ($1, $2, 'gaming.billing_unit_seconds', 'ORGANIZATION', $2, '90'::jsonb),
              ($3, $4, 'gaming.billing_unit_seconds', 'ORGANIZATION', $4, '15'::jsonb)`,
      [createId(), orgA, createId(), orgB],
    );

    await requireGamingAppRole(client);
    await client.query(`SET ROLE gaming_app`);
    await client.query(`SELECT set_config('app.organization_id', $1, false)`, [orgA]);
    const visible = await client.query<{ value: unknown }>(
      `SELECT value FROM core_setting_values WHERE setting_key = 'gaming.billing_unit_seconds'`,
    );
    expect(visible.rows).toHaveLength(1);
    expect(Number(visible.rows[0]?.value)).toBe(90);
  });

  it("rejects moving a customer to another organization", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, orgB } = await seedTwoOrganizations(client);
    const customerId = createId();
    await client.query(
      `INSERT INTO core_customers (id, organization_id, display_name, status, portal_token)
       VALUES ($1, $2, 'Locked', 'ACTIVE', gen_random_uuid())`,
      [customerId, orgA],
    );
    await expect(
      client.query(`UPDATE core_customers SET organization_id = $1 WHERE id = $2`, [orgB, customerId]),
    ).rejects.toThrow();
  });

  it("rejects organization-scoped setting values that include a branch_id", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, branchA } = await seedTwoOrganizations(client);
    await expect(
      client.query(
        `INSERT INTO core_setting_values (id, organization_id, setting_key, scope, scope_id, branch_id, value)
         VALUES ($1, $2, 'gaming.allow_guest_sessions', 'ORGANIZATION', $2, $3, 'true'::jsonb)`,
        [createId(), orgA, branchA],
      ),
    ).rejects.toThrow();
  });

  it("rejects a device whose area belongs to another organization or branch", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, orgB, branchA, branchB } = await seedTwoOrganizations(client);
    const typeA = createId();
    const typeB = createId();
    const areaA = createId();
    const areaB = createId();
    const areaA2 = createId();
    const branchA2 = createId();

    await client.query(
      `INSERT INTO core_branches (id, organization_id, code, name, status)
       VALUES ($1, $2, 'A2', 'Branch A2', 'ACTIVE')`,
      [branchA2, orgA],
    );
    await client.query(
      `INSERT INTO gaming_device_types (id, organization_id, code, name, status)
       VALUES ($1, $2, 'PC', 'PC', 'ACTIVE'), ($3, $4, 'PC', 'PC', 'ACTIVE')`,
      [typeA, orgA, typeB, orgB],
    );
    await client.query(
      `INSERT INTO gaming_areas (id, organization_id, branch_id, code, name, status)
       VALUES ($1, $2, $3, 'MAIN', 'Main', 'ACTIVE'),
              ($4, $5, $6, 'MAIN', 'Main', 'ACTIVE'),
              ($7, $2, $8, 'HALL', 'Hall', 'ACTIVE')`,
      [areaA, orgA, branchA, areaB, orgB, branchB, areaA2, branchA2],
    );

    await expect(
      client.query(
        `INSERT INTO gaming_devices (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
         VALUES ($1, $2, $3, $4, $5, 'PC01', 'PC 01', 'ENABLED')`,
        [createId(), orgA, branchA, areaB, typeA],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        `INSERT INTO gaming_devices (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
         VALUES ($1, $2, $3, $4, $5, 'PC02', 'PC 02', 'ENABLED')`,
        [createId(), orgA, branchA, areaA2, typeA],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        `INSERT INTO gaming_devices (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
         VALUES ($1, $2, $3, $4, $5, 'PC03', 'PC 03', 'ENABLED')`,
        [createId(), orgA, branchA, areaA, typeB],
      ),
    ).rejects.toThrow();
  });

  it("hides other organizations' devices under RLS and rejects ownership mutation", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, orgB, branchA, branchB } = await seedTwoOrganizations(client);
    const typeA = createId();
    const typeB = createId();
    const areaA = createId();
    const areaB = createId();
    const deviceA = createId();
    const deviceB = createId();
    await client.query(
      `INSERT INTO gaming_device_types (id, organization_id, code, name, status)
       VALUES ($1, $2, 'PC', 'PC', 'ACTIVE'), ($3, $4, 'PC', 'PC', 'ACTIVE')`,
      [typeA, orgA, typeB, orgB],
    );
    await client.query(
      `INSERT INTO gaming_areas (id, organization_id, branch_id, code, name, status)
       VALUES ($1, $2, $3, 'MAIN', 'Main', 'ACTIVE'), ($4, $5, $6, 'MAIN', 'Main', 'ACTIVE')`,
      [areaA, orgA, branchA, areaB, orgB, branchB],
    );
    await client.query(
      `INSERT INTO gaming_devices (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
       VALUES ($1, $2, $3, $4, $5, 'PC01', 'A', 'ENABLED'),
              ($6, $7, $8, $9, $10, 'PC01', 'B', 'ENABLED')`,
      [deviceA, orgA, branchA, areaA, typeA, deviceB, orgB, branchB, areaB, typeB],
    );

    await requireGamingAppRole(client);
    await client.query(`SET ROLE gaming_app`);
    await client.query(`SELECT set_config('app.organization_id', $1, false)`, [orgA]);
    const visible = await client.query<{ name: string }>(`SELECT name FROM gaming_devices ORDER BY name`);
    expect(visible.rows.map((row) => row.name)).toEqual(["A"]);

    await client.query(`RESET ROLE`);
    await expect(
      client.query(`UPDATE gaming_devices SET organization_id = $1 WHERE id = $2`, [orgB, deviceA]),
    ).rejects.toThrow();
    await expect(
      client.query(`UPDATE gaming_areas SET branch_id = $1 WHERE id = $2`, [branchB, areaA]),
    ).rejects.toThrow();
  });

  it("rejects a pricing assignment whose area is in another branch", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, branchA } = await seedTwoOrganizations(client);
    const branchA2 = createId();
    const typeA = createId();
    const areaA = createId();
    const areaA2 = createId();
    const plan = createId();
    await client.query(
      `INSERT INTO core_branches (id, organization_id, code, name, status)
       VALUES ($1, $2, 'A2', 'Branch A2', 'ACTIVE')`,
      [branchA2, orgA],
    );
    await client.query(
      `INSERT INTO gaming_device_types (id, organization_id, code, name, status)
       VALUES ($1, $2, 'PC', 'PC', 'ACTIVE')`,
      [typeA, orgA],
    );
    await client.query(
      `INSERT INTO gaming_areas (id, organization_id, branch_id, code, name, status)
       VALUES ($1, $2, $3, 'MAIN', 'Main', 'ACTIVE'), ($4, $2, $5, 'HALL', 'Hall', 'ACTIVE')`,
      [areaA, orgA, branchA, areaA2, branchA2],
    );
    await client.query(
      `INSERT INTO gaming_pricing_plans (
         id, organization_id, code, name, pricing_model, currency, rate_minor, billing_unit_seconds, rounding_mode, status
       ) VALUES ($1, $2, 'STD', 'Standard', 'TIME_BASED', 'SYP', 100, 60, 'CEIL', 'ACTIVE')`,
      [plan, orgA],
    );
    await expect(
      client.query(
        `INSERT INTO gaming_pricing_assignments (
           id, organization_id, branch_id, pricing_plan_id, scope_type, scope_id, status
         ) VALUES ($1, $2, $3, $4, 'AREA', $5, 'ACTIVE')`,
        [createId(), orgA, branchA, plan, areaA2],
      ),
    ).rejects.toThrow();
  });

  it("hides other organizations' sessions under RLS and rejects occupancy overlap", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, orgB, branchA, branchB } = await seedTwoOrganizations(client);
    const userA = createId();
    const typeA = createId();
    const areaA = createId();
    const deviceA = createId();
    const planA = createId();
    const sessionA = createId();
    const sessionB = createId();
    await client.query(
      `INSERT INTO core_users (id, auth_subject, display_name, status)
       VALUES ($1, $2, 'Op', 'ACTIVE')`,
      [userA, `sub-${userA}`],
    );
    await client.query(
      `INSERT INTO gaming_device_types (id, organization_id, code, name, status)
       VALUES ($1, $2, 'PC', 'PC', 'ACTIVE')`,
      [typeA, orgA],
    );
    await client.query(
      `INSERT INTO gaming_areas (id, organization_id, branch_id, code, name, status)
       VALUES ($1, $2, $3, 'MAIN', 'Main', 'ACTIVE')`,
      [areaA, orgA, branchA],
    );
    await client.query(
      `INSERT INTO gaming_devices (id, organization_id, branch_id, area_id, device_type_id, code, name, operational_status)
       VALUES ($1, $2, $3, $4, $5, 'PC01', 'A', 'ENABLED')`,
      [deviceA, orgA, branchA, areaA, typeA],
    );
    await client.query(
      `INSERT INTO gaming_pricing_plans (
         id, organization_id, code, name, pricing_model, currency, rate_minor, billing_unit_seconds, rounding_mode, status
       ) VALUES ($1, $2, 'STD', 'Standard', 'TIME_BASED', 'SYP', 100, 60, 'CEIL', 'ACTIVE')`,
      [planA, orgA],
    );
    await client.query(
      `INSERT INTO gaming_sessions (
         id, organization_id, branch_id, session_number, session_type, status, current_device_id, created_by
       ) VALUES ($1, $2, $3, '1', 'OPEN', 'ACTIVE', $4, $5)`,
      [sessionA, orgA, branchA, deviceA, userA],
    );
    await client.query(
      `INSERT INTO gaming_session_segments (
         id, organization_id, branch_id, session_id, device_id, pricing_plan_id, started_at, pricing_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, now(), '{"pricingPlanId":"x"}'::jsonb)`,
      [createId(), orgA, branchA, sessionA, deviceA, planA],
    );

    await requireGamingAppRole(client);
    await client.query(`SET ROLE gaming_app`);
    await client.query(`SELECT set_config('app.organization_id', $1, false)`, [orgB]);
    const hidden = await client.query<{ id: string }>(`SELECT id FROM gaming_sessions`);
    expect(hidden.rows).toEqual([]);
    const hiddenSegments = await client.query<{ id: string }>(`SELECT id FROM gaming_session_segments`);
    expect(hiddenSegments.rows).toEqual([]);

    await client.query(`RESET ROLE`);
    await expect(
      client.query(`UPDATE gaming_sessions SET organization_id = $1 WHERE id = $2`, [orgB, sessionA]),
    ).rejects.toThrow();
    await expect(
      client.query(
        `INSERT INTO gaming_sessions (
           id, organization_id, branch_id, session_number, session_type, status, current_device_id, created_by
         ) VALUES ($1, $2, $3, '2', 'OPEN', 'ACTIVE', $4, $5)`,
        [sessionB, orgA, branchA, deviceA, userA],
      ),
    ).rejects.toThrow();
    await expect(
      client.query(
        `INSERT INTO gaming_sessions (
           id, organization_id, branch_id, session_number, session_type, status, current_device_id, created_by
         ) VALUES ($1, $2, $3, '1', 'OPEN', 'ACTIVE', $4, $5)`,
        [createId(), orgB, branchB, deviceA, userA],
      ),
    ).rejects.toThrow();
  });

  it("hides other organizations' payments under RLS and rejects cross-tenant payment rows", async () => {
    const { client } = await createMigratedPglite();
    const { orgA, orgB, branchA, branchB } = await seedTwoOrganizations(client);
    const userA = createId();
    const methodA = createId();
    const chargeA = createId();
    const paymentA = createId();
    await client.query(
      `INSERT INTO core_users (id, auth_subject, display_name, status)
       VALUES ($1, $2, 'Cashier', 'ACTIVE')`,
      [userA, `sub-${userA}`],
    );
    await client.query(
      `INSERT INTO finance_payment_methods (id, organization_id, code, name, method_type, requires_reference, status)
       VALUES ($1, $2, 'CASH', 'Cash', 'CASH', false, 'ACTIVE')`,
      [methodA, orgA],
    );
    await client.query(
      `INSERT INTO finance_charges (
         id, organization_id, branch_id, source_module, source_type, source_id,
         status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, created_by
       ) VALUES (
         $1, $2, $3, 'gaming', 'session', $4,
         'OPEN', 'SYP', 200, 0, 0, 200, $5
       )`,
      [chargeA, orgA, branchA, createId(), userA],
    );
    await client.query(
      `INSERT INTO finance_payments (
         id, organization_id, branch_id, payment_method_id, status, currency, amount_minor, created_by
       ) VALUES ($1, $2, $3, $4, 'COMPLETED', 'SYP', 200, $5)`,
      [paymentA, orgA, branchA, methodA, userA],
    );
    await client.query(
      `INSERT INTO finance_payment_allocations (id, organization_id, payment_id, charge_id, amount_minor)
       VALUES ($1, $2, $3, $4, 200)`,
      [createId(), orgA, paymentA, chargeA],
    );

    await requireGamingAppRole(client);
    await client.query(`SET ROLE gaming_app`);
    await client.query(`SELECT set_config('app.organization_id', $1, false)`, [orgB]);
    const hidden = await client.query<{ id: string }>(`SELECT id FROM finance_payments`);
    expect(hidden.rows).toEqual([]);
    const hiddenCharges = await client.query<{ id: string }>(`SELECT id FROM finance_charges`);
    expect(hiddenCharges.rows).toEqual([]);

    await client.query(`RESET ROLE`);
    await expect(
      client.query(`UPDATE finance_payments SET amount_minor = 1 WHERE id = $1`, [paymentA]),
    ).rejects.toThrow();
    await expect(client.query(`DELETE FROM finance_payments WHERE id = $1`, [paymentA])).rejects.toThrow();
    await expect(
      client.query(
        `INSERT INTO finance_payments (
           id, organization_id, branch_id, payment_method_id, status, currency, amount_minor, created_by
         ) VALUES ($1, $2, $3, $4, 'COMPLETED', 'SYP', 50, $5)`,
        [createId(), orgB, branchB, methodA, userA],
      ),
    ).rejects.toThrow();
  });
});
