-- 0005_configuration_customers.sql
-- Purpose: Milestone 3 — configuration & customer core.
-- Forward-safe. Does not rewrite 0001–0004. Does not add gaming/POS/finance/cards tables.
--
-- 1. core.settings.read for admin surfaces (manage already exists from 0001).
--    Backfill the seeded OWNER system role so existing tenants keep full catalog access.
-- 2. Customer email search index (blueprint listed it; 0001 only indexed phone/name).
-- 3. Non-empty display_name; setting-value scope/branch shape.
-- 4. Immutable ownership columns on customers and setting values.

-- ---------------------------------------------------------------------------
-- Permission registry
-- ---------------------------------------------------------------------------
INSERT INTO core_permissions (code, module, name, description, risk_level) VALUES
  ('core.settings.read', 'core', 'Read settings', 'View organization settings and feature flags', 'LOW')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core_role_permissions (organization_id, role_id, permission_code)
SELECT r.organization_id, r.id, 'core.settings.read'
FROM core_roles r
WHERE r.is_system = true
  AND r.code = 'OWNER'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Customers: searchable email, non-empty name
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS core_customers_org_email_idx
  ON core_customers (organization_id, email_normalized);

ALTER TABLE core_customers
  DROP CONSTRAINT IF EXISTS core_customers_display_name_chk;

ALTER TABLE core_customers
  ADD CONSTRAINT core_customers_display_name_chk
  CHECK (char_length(btrim(display_name)) > 0);

-- ---------------------------------------------------------------------------
-- Setting values: ORGANIZATION/BRANCH rows must match scope_id / branch_id
-- ENTITY remains available for later entity-scoped settings.
-- ---------------------------------------------------------------------------
ALTER TABLE core_setting_values
  DROP CONSTRAINT IF EXISTS core_setting_values_scope_shape_chk;

ALTER TABLE core_setting_values
  ADD CONSTRAINT core_setting_values_scope_shape_chk
  CHECK (
    (scope = 'ORGANIZATION' AND branch_id IS NULL AND scope_id = organization_id)
    OR (scope = 'BRANCH' AND branch_id IS NOT NULL AND scope_id = branch_id)
    OR (scope = 'ENTITY')
  );

-- ---------------------------------------------------------------------------
-- Immutable ownership identifiers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_customer_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'customer id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'customer organization_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'customer created_at is immutable';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'customer created_by is immutable';
  END IF;
  IF NEW.created_branch_id IS DISTINCT FROM OLD.created_branch_id THEN
    RAISE EXCEPTION 'customer created_branch_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_core_customers_invariants ON core_customers;

CREATE TRIGGER trg_core_customers_invariants
  BEFORE UPDATE ON core_customers
  FOR EACH ROW
  EXECUTE FUNCTION enforce_customer_row_invariants();

CREATE OR REPLACE FUNCTION enforce_setting_value_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'setting value id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'setting value organization_id is immutable';
  END IF;
  IF NEW.setting_key IS DISTINCT FROM OLD.setting_key THEN
    RAISE EXCEPTION 'setting value setting_key is immutable';
  END IF;
  IF NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION 'setting value scope is immutable';
  END IF;
  IF NEW.scope_id IS DISTINCT FROM OLD.scope_id THEN
    RAISE EXCEPTION 'setting value scope_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'setting value branch_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'setting value created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_core_setting_values_invariants ON core_setting_values;

CREATE TRIGGER trg_core_setting_values_invariants
  BEFORE UPDATE ON core_setting_values
  FOR EACH ROW
  EXECUTE FUNCTION enforce_setting_value_row_invariants();

GRANT EXECUTE ON FUNCTION enforce_customer_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_setting_value_row_invariants() TO gaming_app;
