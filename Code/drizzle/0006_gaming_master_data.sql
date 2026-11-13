-- 0006_gaming_master_data.sql
-- Purpose: Milestone 4 — gaming master data (areas, device types, devices,
-- pricing plans, pricing assignments). Forward-safe. Does not rewrite 0001–0005.
-- Does not create sessions, segments, pauses, maintenance logs, floor occupancy,
-- billing engines, POS, inventory, finance ledgers, or cards_*.
--
-- 1. gaming.master.read / gaming.master.manage; OWNER backfill.
-- 2. Branch-owned areas and devices; organization-owned device types and plans.
-- 3. Composite tenant FKs, CHECKs, RLS (no bypass), immutable ownership.

-- ---------------------------------------------------------------------------
-- Permission registry
-- ---------------------------------------------------------------------------
INSERT INTO core_permissions (code, module, name, description, risk_level) VALUES
  ('gaming.master.read', 'gaming', 'Read gaming master data', 'View areas, device types, devices, and pricing plans', 'LOW'),
  ('gaming.master.manage', 'gaming', 'Manage gaming master data', 'Create, update, or archive areas, device types, devices, and pricing plans', 'HIGH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core_role_permissions (organization_id, role_id, permission_code)
SELECT r.organization_id, r.id, p.code
FROM core_roles r
CROSS JOIN (VALUES ('gaming.master.read'), ('gaming.master.manage')) AS p(code)
WHERE r.is_system = true
  AND r.code = 'OWNER'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- gaming_areas (branch-owned)
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_areas (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaming_areas_status_chk
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT gaming_areas_code_chk
    CHECK (char_length(btrim(code)) > 0),
  CONSTRAINT gaming_areas_name_chk
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT gaming_areas_org_branch_code_key
    UNIQUE (organization_id, branch_id, code),
  CONSTRAINT gaming_areas_id_org_key
    UNIQUE (id, organization_id),
  CONSTRAINT gaming_areas_id_org_branch_key
    UNIQUE (id, organization_id, branch_id),
  CONSTRAINT gaming_areas_branch_tenant_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id)
);

CREATE INDEX gaming_areas_org_branch_status_idx
  ON gaming_areas (organization_id, branch_id, status);

-- ---------------------------------------------------------------------------
-- gaming_device_types (organization-owned)
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_device_types (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  code text NOT NULL,
  name text NOT NULL,
  category text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaming_device_types_status_chk
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT gaming_device_types_code_chk
    CHECK (char_length(btrim(code)) > 0),
  CONSTRAINT gaming_device_types_name_chk
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT gaming_device_types_org_code_key
    UNIQUE (organization_id, code),
  CONSTRAINT gaming_device_types_id_org_key
    UNIQUE (id, organization_id)
);

CREATE INDEX gaming_device_types_org_status_idx
  ON gaming_device_types (organization_id, status);

-- ---------------------------------------------------------------------------
-- gaming_devices (branch-owned master records — not live session state)
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_devices (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  area_id uuid NOT NULL,
  device_type_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  operational_status text NOT NULL,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT gaming_devices_operational_status_chk
    CHECK (operational_status IN ('ENABLED', 'MAINTENANCE', 'DISABLED')),
  CONSTRAINT gaming_devices_code_chk
    CHECK (char_length(btrim(code)) > 0),
  CONSTRAINT gaming_devices_name_chk
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT gaming_devices_org_branch_code_key
    UNIQUE (organization_id, branch_id, code),
  CONSTRAINT gaming_devices_id_org_key
    UNIQUE (id, organization_id),
  CONSTRAINT gaming_devices_id_org_branch_key
    UNIQUE (id, organization_id, branch_id),
  CONSTRAINT gaming_devices_branch_tenant_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT gaming_devices_area_tenant_fk
    FOREIGN KEY (area_id, organization_id, branch_id)
    REFERENCES gaming_areas (id, organization_id, branch_id),
  CONSTRAINT gaming_devices_type_tenant_fk
    FOREIGN KEY (device_type_id, organization_id)
    REFERENCES gaming_device_types (id, organization_id)
);

CREATE INDEX gaming_devices_org_branch_area_status_idx
  ON gaming_devices (organization_id, branch_id, area_id, operational_status);

CREATE TRIGGER trg_gaming_devices_updated_at
  BEFORE UPDATE ON gaming_devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- gaming_pricing_plans (organization-owned master data — not billing engine)
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_pricing_plans (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  code text NOT NULL,
  name text NOT NULL,
  pricing_model text NOT NULL,
  currency char(3) NOT NULL,
  rate_minor bigint,
  billing_unit_seconds integer,
  rounding_mode text NOT NULL,
  minimum_billable_seconds integer NOT NULL DEFAULT 0,
  minimum_charge_minor bigint NOT NULL DEFAULT 0,
  package_duration_seconds integer,
  package_price_minor bigint,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaming_pricing_plans_status_chk
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT gaming_pricing_plans_model_chk
    CHECK (pricing_model IN ('TIME_BASED', 'PACKAGE')),
  CONSTRAINT gaming_pricing_plans_rounding_chk
    CHECK (rounding_mode IN ('CEIL', 'NEAREST', 'FLOOR')),
  CONSTRAINT gaming_pricing_plans_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT gaming_pricing_plans_code_chk
    CHECK (char_length(btrim(code)) > 0),
  CONSTRAINT gaming_pricing_plans_name_chk
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT gaming_pricing_plans_minimums_chk
    CHECK (minimum_billable_seconds >= 0 AND minimum_charge_minor >= 0),
  CONSTRAINT gaming_pricing_plans_shape_chk
    CHECK (
      (
        pricing_model = 'TIME_BASED'
        AND rate_minor IS NOT NULL AND rate_minor >= 0
        AND billing_unit_seconds IS NOT NULL AND billing_unit_seconds > 0
        AND package_duration_seconds IS NULL
        AND package_price_minor IS NULL
      )
      OR (
        pricing_model = 'PACKAGE'
        AND package_duration_seconds IS NOT NULL AND package_duration_seconds > 0
        AND package_price_minor IS NOT NULL AND package_price_minor >= 0
        AND rate_minor IS NULL
        AND billing_unit_seconds IS NULL
      )
    ),
  CONSTRAINT gaming_pricing_plans_org_code_key
    UNIQUE (organization_id, code),
  CONSTRAINT gaming_pricing_plans_id_org_key
    UNIQUE (id, organization_id)
);

CREATE INDEX gaming_pricing_plans_org_status_idx
  ON gaming_pricing_plans (organization_id, status);

-- ---------------------------------------------------------------------------
-- gaming_pricing_assignments (scope binding — not price calculation)
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_pricing_assignments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid,
  pricing_plan_id uuid NOT NULL,
  scope_type text NOT NULL,
  scope_id uuid NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaming_pricing_assignments_scope_type_chk
    CHECK (scope_type IN ('ORGANIZATION', 'BRANCH', 'AREA', 'DEVICE_TYPE', 'DEVICE')),
  CONSTRAINT gaming_pricing_assignments_status_chk
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT gaming_pricing_assignments_validity_chk
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT gaming_pricing_assignments_scope_shape_chk
    CHECK (
      (scope_type = 'ORGANIZATION' AND branch_id IS NULL AND scope_id = organization_id)
      OR (scope_type = 'BRANCH' AND branch_id IS NOT NULL AND scope_id = branch_id)
      OR (scope_type = 'AREA' AND branch_id IS NOT NULL)
      OR (scope_type = 'DEVICE_TYPE' AND branch_id IS NULL)
      OR (scope_type = 'DEVICE' AND branch_id IS NOT NULL)
    ),
  CONSTRAINT gaming_pricing_assignments_id_org_key
    UNIQUE (id, organization_id),
  CONSTRAINT gaming_pricing_assignments_plan_tenant_fk
    FOREIGN KEY (pricing_plan_id, organization_id)
    REFERENCES gaming_pricing_plans (id, organization_id),
  CONSTRAINT gaming_pricing_assignments_branch_tenant_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id)
);

CREATE INDEX gaming_pricing_assignments_scope_idx
  ON gaming_pricing_assignments (organization_id, branch_id, scope_type, scope_id, valid_from DESC);

-- ---------------------------------------------------------------------------
-- Immutable ownership + polymorphic assignment scope
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_gaming_area_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'area id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'area organization_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'area branch_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'area created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gaming_areas_invariants
  BEFORE UPDATE ON gaming_areas
  FOR EACH ROW
  EXECUTE FUNCTION enforce_gaming_area_row_invariants();

CREATE OR REPLACE FUNCTION enforce_gaming_device_type_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'device type id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'device type organization_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'device type created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gaming_device_types_invariants
  BEFORE UPDATE ON gaming_device_types
  FOR EACH ROW
  EXECUTE FUNCTION enforce_gaming_device_type_row_invariants();

CREATE OR REPLACE FUNCTION enforce_gaming_device_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'device id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'device organization_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'device branch_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'device created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gaming_devices_invariants
  BEFORE UPDATE ON gaming_devices
  FOR EACH ROW
  EXECUTE FUNCTION enforce_gaming_device_row_invariants();

CREATE OR REPLACE FUNCTION enforce_gaming_pricing_plan_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'pricing plan id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'pricing plan organization_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'pricing plan created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gaming_pricing_plans_invariants
  BEFORE UPDATE ON gaming_pricing_plans
  FOR EACH ROW
  EXECUTE FUNCTION enforce_gaming_pricing_plan_row_invariants();

CREATE OR REPLACE FUNCTION enforce_gaming_pricing_assignment_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'pricing assignment id is immutable';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'pricing assignment organization_id is immutable';
    END IF;
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'pricing assignment branch_id is immutable';
    END IF;
    IF NEW.pricing_plan_id IS DISTINCT FROM OLD.pricing_plan_id THEN
      RAISE EXCEPTION 'pricing assignment pricing_plan_id is immutable';
    END IF;
    IF NEW.scope_type IS DISTINCT FROM OLD.scope_type THEN
      RAISE EXCEPTION 'pricing assignment scope_type is immutable';
    END IF;
    IF NEW.scope_id IS DISTINCT FROM OLD.scope_id THEN
      RAISE EXCEPTION 'pricing assignment scope_id is immutable';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'pricing assignment created_at is immutable';
    END IF;
  END IF;

  IF NEW.scope_type = 'ORGANIZATION' THEN
    IF NEW.branch_id IS NOT NULL OR NEW.scope_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'ORGANIZATION assignment scope is invalid';
    END IF;
  ELSIF NEW.scope_type = 'BRANCH' THEN
    IF NEW.branch_id IS NULL OR NEW.scope_id IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION 'BRANCH assignment scope is invalid';
    END IF;
  ELSIF NEW.scope_type = 'AREA' THEN
    IF NEW.branch_id IS NULL THEN
      RAISE EXCEPTION 'AREA assignment requires branch_id';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM gaming_areas a
      WHERE a.id = NEW.scope_id
        AND a.organization_id = NEW.organization_id
        AND a.branch_id = NEW.branch_id
    ) THEN
      RAISE EXCEPTION 'AREA assignment scope_id must be an area in the same organization and branch';
    END IF;
  ELSIF NEW.scope_type = 'DEVICE_TYPE' THEN
    IF NEW.branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'DEVICE_TYPE assignment must not set branch_id';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM gaming_device_types t
      WHERE t.id = NEW.scope_id
        AND t.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'DEVICE_TYPE assignment scope_id must be a device type in the same organization';
    END IF;
  ELSIF NEW.scope_type = 'DEVICE' THEN
    IF NEW.branch_id IS NULL THEN
      RAISE EXCEPTION 'DEVICE assignment requires branch_id';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM gaming_devices d
      WHERE d.id = NEW.scope_id
        AND d.organization_id = NEW.organization_id
        AND d.branch_id = NEW.branch_id
    ) THEN
      RAISE EXCEPTION 'DEVICE assignment scope_id must be a device in the same organization and branch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gaming_pricing_assignments_row
  BEFORE INSERT OR UPDATE ON gaming_pricing_assignments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_gaming_pricing_assignment_row();

-- ---------------------------------------------------------------------------
-- RLS — tenant match only. No bypass GUC or function.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gaming_areas',
    'gaming_device_types',
    'gaming_devices',
    'gaming_pricing_plans',
    'gaming_pricing_assignments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY gaming_areas_tenant ON gaming_areas
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY gaming_device_types_tenant ON gaming_device_types
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY gaming_devices_tenant ON gaming_devices
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY gaming_pricing_plans_tenant ON gaming_pricing_plans
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY gaming_pricing_assignments_tenant ON gaming_pricing_assignments
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  gaming_areas,
  gaming_device_types,
  gaming_devices,
  gaming_pricing_plans,
  gaming_pricing_assignments
TO gaming_app;

GRANT EXECUTE ON FUNCTION enforce_gaming_area_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_gaming_device_type_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_gaming_device_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_gaming_pricing_plan_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_gaming_pricing_assignment_row() TO gaming_app;
