-- 0001_core_foundation.sql
-- Purpose: Gaming Center core tenancy, identity, authorization, configuration,
-- customers, append-only audit, transactional outbox, and idempotency.
-- Does not create gaming sessions, POS, inventory, finance ledgers, or cards_*.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app_current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_bypass_rls()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT lower(nullif(current_setting('app.bypass_rls', true), '')) = 'on'
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION forbid_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'core_audit_logs is append-only';
END;
$$;

-- ---------------------------------------------------------------------------
-- Organizations (tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE core_organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  legal_name text,
  status text NOT NULL,
  default_currency char(3) NOT NULL,
  timezone text NOT NULL,
  locale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT core_organizations_slug_key UNIQUE (slug),
  CONSTRAINT core_organizations_status_chk
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'))
);

CREATE TRIGGER trg_core_organizations_updated_at
  BEFORE UPDATE ON core_organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Branches
-- ---------------------------------------------------------------------------
CREATE TABLE core_branches (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  timezone text,
  address_text text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT core_branches_status_chk
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT core_branches_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT core_branches_id_org_key UNIQUE (id, organization_id)
);

CREATE INDEX core_branches_org_status_idx
  ON core_branches (organization_id, status);

CREATE TRIGGER trg_core_branches_updated_at
  BEFORE UPDATE ON core_branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Users (global identity — not tenant-owned)
-- ---------------------------------------------------------------------------
CREATE TABLE core_users (
  id uuid PRIMARY KEY,
  auth_subject text NOT NULL,
  email text,
  display_name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_users_auth_subject_key UNIQUE (auth_subject),
  CONSTRAINT core_users_status_chk
    CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED'))
);

CREATE INDEX core_users_email_lower_idx
  ON core_users (lower(email))
  WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Memberships
-- ---------------------------------------------------------------------------
CREATE TABLE core_organization_memberships (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  user_id uuid NOT NULL REFERENCES core_users (id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_organization_memberships_status_chk
    CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED')),
  CONSTRAINT core_organization_memberships_org_user_key UNIQUE (organization_id, user_id),
  CONSTRAINT core_organization_memberships_id_org_key UNIQUE (id, organization_id)
);

CREATE INDEX core_organization_memberships_user_status_idx
  ON core_organization_memberships (user_id, status);

-- ---------------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------------
CREATE TABLE core_roles (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_roles_status_chk
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT core_roles_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT core_roles_id_org_key UNIQUE (id, organization_id)
);

CREATE TABLE core_permissions (
  code text PRIMARY KEY,
  module text NOT NULL,
  name text NOT NULL,
  description text,
  risk_level text NOT NULL,
  CONSTRAINT core_permissions_risk_chk
    CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH'))
);

CREATE TABLE core_role_permissions (
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  role_id uuid NOT NULL,
  permission_code text NOT NULL REFERENCES core_permissions (code),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_role_permissions_pkey PRIMARY KEY (role_id, permission_code),
  CONSTRAINT core_role_permissions_role_org_fk
    FOREIGN KEY (role_id, organization_id)
    REFERENCES core_roles (id, organization_id)
);

CREATE INDEX core_role_permissions_org_role_idx
  ON core_role_permissions (organization_id, role_id);

CREATE TABLE core_membership_roles (
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_membership_roles_mem_role_key UNIQUE (membership_id, role_id),
  CONSTRAINT core_membership_roles_membership_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES core_organization_memberships (id, organization_id),
  CONSTRAINT core_membership_roles_role_fk
    FOREIGN KEY (role_id, organization_id)
    REFERENCES core_roles (id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Branch access (independent of roles)
-- ---------------------------------------------------------------------------
CREATE TABLE core_branch_access (
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  membership_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  access_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_branch_access_mode_chk
    CHECK (access_mode IN ('VIEW', 'OPERATE', 'MANAGE')),
  CONSTRAINT core_branch_access_mem_branch_key UNIQUE (membership_id, branch_id),
  CONSTRAINT core_branch_access_membership_fk
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES core_organization_memberships (id, organization_id),
  CONSTRAINT core_branch_access_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id)
);

CREATE INDEX core_branch_access_org_branch_idx
  ON core_branch_access (organization_id, branch_id);

-- ---------------------------------------------------------------------------
-- Settings & features
-- ---------------------------------------------------------------------------
CREATE TABLE core_settings_definitions (
  key text PRIMARY KEY,
  module text NOT NULL,
  value_type text NOT NULL,
  default_value jsonb,
  allowed_scopes text[] NOT NULL,
  description text,
  is_sensitive boolean NOT NULL DEFAULT false,
  CONSTRAINT core_settings_definitions_type_chk
    CHECK (value_type IN ('STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'ENUM'))
);

CREATE TABLE core_setting_values (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  setting_key text NOT NULL REFERENCES core_settings_definitions (key),
  scope text NOT NULL,
  scope_id uuid NOT NULL,
  branch_id uuid,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_setting_values_scope_chk
    CHECK (scope IN ('ORGANIZATION', 'BRANCH', 'ENTITY')),
  CONSTRAINT core_setting_values_scope_key
    UNIQUE (organization_id, setting_key, scope, scope_id),
  CONSTRAINT core_setting_values_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id)
);

CREATE INDEX core_setting_values_org_branch_key_idx
  ON core_setting_values (organization_id, branch_id, setting_key);

CREATE TRIGGER trg_core_setting_values_updated_at
  BEFORE UPDATE ON core_setting_values
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE core_features (
  code text PRIMARY KEY,
  module text NOT NULL,
  description text,
  default_enabled boolean NOT NULL DEFAULT false
);

CREATE TABLE core_organization_features (
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  feature_code text NOT NULL REFERENCES core_features (code),
  enabled boolean NOT NULL,
  config jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_organization_features_pkey PRIMARY KEY (organization_id, feature_code)
);

CREATE TRIGGER trg_core_organization_features_updated_at
  BEFORE UPDATE ON core_organization_features
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Customers (organization-level)
-- ---------------------------------------------------------------------------
CREATE TABLE core_customers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  customer_code text,
  display_name text NOT NULL,
  phone_normalized text,
  email_normalized text,
  status text NOT NULL,
  notes text,
  created_branch_id uuid,
  created_by uuid REFERENCES core_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_customers_status_chk
    CHECK (status IN ('ACTIVE', 'BLOCKED', 'ARCHIVED')),
  CONSTRAINT core_customers_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT core_customers_branch_fk
    FOREIGN KEY (created_branch_id, organization_id)
    REFERENCES core_branches (id, organization_id)
);

CREATE INDEX core_customers_org_phone_idx
  ON core_customers (organization_id, phone_normalized);

CREATE INDEX core_customers_org_name_idx
  ON core_customers (organization_id, display_name);

CREATE TRIGGER trg_core_customers_updated_at
  BEFORE UPDATE ON core_customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE core_audit_logs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid,
  actor_user_id uuid REFERENCES core_users (id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_audit_logs_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id)
);

CREATE INDEX core_audit_logs_org_time_idx
  ON core_audit_logs (organization_id, occurred_at DESC);

CREATE INDEX core_audit_logs_org_entity_idx
  ON core_audit_logs (organization_id, entity_type, entity_id, occurred_at DESC);

CREATE TRIGGER trg_core_audit_logs_no_update
  BEFORE UPDATE OR DELETE ON core_audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- ---------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------
CREATE TABLE core_outbox_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  CONSTRAINT core_outbox_events_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id)
);

CREATE INDEX core_outbox_events_unpublished_idx
  ON core_outbox_events (occurred_at)
  WHERE published_at IS NULL;

CREATE INDEX core_outbox_events_org_type_idx
  ON core_outbox_events (organization_id, event_type, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE core_idempotency_keys (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT core_idempotency_keys_org_scope_key
    UNIQUE (organization_id, scope, idempotency_key)
);

CREATE INDEX core_idempotency_keys_expires_idx
  ON core_idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core_organizations',
    'core_branches',
    'core_organization_memberships',
    'core_roles',
    'core_role_permissions',
    'core_membership_roles',
    'core_branch_access',
    'core_setting_values',
    'core_organization_features',
    'core_customers',
    'core_audit_logs',
    'core_outbox_events',
    'core_idempotency_keys'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY core_organizations_tenant ON core_organizations
  USING (app_bypass_rls() OR id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR id = app_current_organization_id());

CREATE POLICY core_branches_tenant ON core_branches
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_organization_memberships_tenant ON core_organization_memberships
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_roles_tenant ON core_roles
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_role_permissions_tenant ON core_role_permissions
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_membership_roles_tenant ON core_membership_roles
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_branch_access_tenant ON core_branch_access
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_setting_values_tenant ON core_setting_values
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_organization_features_tenant ON core_organization_features
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_customers_tenant ON core_customers
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_audit_logs_tenant ON core_audit_logs
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_outbox_events_tenant ON core_outbox_events
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_idempotency_keys_tenant ON core_idempotency_keys
  USING (app_bypass_rls() OR organization_id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

-- Runtime role for request-path queries (no BYPASSRLS). Owner still used for migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gaming_app') THEN
    CREATE ROLE gaming_app NOINHERIT LOGIN;
  END IF;
  GRANT USAGE ON SCHEMA public TO gaming_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gaming_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gaming_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gaming_app;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'gaming_app role not created (engine/privilege limitation): %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- Registry seed (system-wide, not tenant data)
-- ---------------------------------------------------------------------------
INSERT INTO core_permissions (code, module, name, description, risk_level) VALUES
  ('core.organizations.read', 'core', 'Read organization', 'View organization profile', 'LOW'),
  ('core.organizations.manage', 'core', 'Manage organization', 'Update organization profile', 'HIGH'),
  ('core.branches.read', 'core', 'Read branches', 'View branches', 'LOW'),
  ('core.branches.manage', 'core', 'Manage branches', 'Create or archive branches', 'HIGH'),
  ('core.memberships.manage', 'core', 'Manage memberships', 'Invite and suspend users', 'HIGH'),
  ('core.roles.manage', 'core', 'Manage roles', 'Edit roles and permissions', 'HIGH'),
  ('core.settings.manage', 'core', 'Manage settings', 'Change business configuration', 'HIGH'),
  ('core.customers.read', 'core', 'Read customers', 'View customers', 'LOW'),
  ('core.customers.manage', 'core', 'Manage customers', 'Create or update customers', 'MEDIUM'),
  ('core.audit.read', 'core', 'Read audit', 'View audit history', 'MEDIUM');

INSERT INTO core_features (code, module, description, default_enabled) VALUES
  ('gaming.floor', 'gaming', 'Gaming floor operations', true),
  ('pos.sales', 'pos', 'Point of sale', true),
  ('inventory.stock', 'inventory', 'Inventory tracking', true);

INSERT INTO core_settings_definitions (key, module, value_type, default_value, allowed_scopes, description, is_sensitive) VALUES
  ('gaming.billing_unit_seconds', 'gaming', 'NUMBER', '60'::jsonb, ARRAY['ORGANIZATION', 'BRANCH'], 'Billing granularity in seconds', false),
  ('gaming.allow_guest_sessions', 'gaming', 'BOOLEAN', 'true'::jsonb, ARRAY['ORGANIZATION', 'BRANCH'], 'Allow sessions without a customer', false);
