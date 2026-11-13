-- 0002_identity_auth.sql
-- Purpose: Milestone 2 — Identity & admin core.
--   1. Better Auth provider tables (auth_*). Credentials and login sessions live
--      here, never in core_* tables. core_users.auth_subject stores auth_users.id
--      as an opaque text subject (no FK, so the provider stays swappable).
--   2. Blueprint columns that activate in this milestone:
--      core_users.last_login_at, core_organization_memberships.joined_at.
--   3. app.user_id transaction-local context + refined RLS policies so an
--      authenticated user can read their own memberships (and the organizations
--      those memberships point at) before an organization is selected.
--   4. Read-level permission registry entries for the admin surfaces.
-- No gaming/POS/inventory/finance/cards tables.

-- ---------------------------------------------------------------------------
-- Authentication provider tables (Better Auth). Global scope: no organization_id,
-- no RLS. Application code must never expose these rows to tenants.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_users_email_key UNIQUE (email)
);

CREATE TABLE auth_sessions (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  CONSTRAINT auth_sessions_token_key UNIQUE (token)
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);

CREATE TABLE auth_accounts (
  id text PRIMARY KEY,
  issuer text NOT NULL,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_accounts_user_id_idx ON auth_accounts (user_id);
CREATE INDEX auth_accounts_provider_account_idx ON auth_accounts (provider_id, account_id);

CREATE TABLE auth_verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_verifications_identifier_idx ON auth_verifications (identifier);

-- ---------------------------------------------------------------------------
-- Blueprint columns activated by this milestone
-- ---------------------------------------------------------------------------
ALTER TABLE core_users
  ADD COLUMN last_login_at timestamptz;

ALTER TABLE core_organization_memberships
  ADD COLUMN joined_at timestamptz;

-- ---------------------------------------------------------------------------
-- Authenticated-user context (transaction-local, set by the server only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- RLS refinement (ADR 0004 allows policy refinement):
-- a user must be able to read their own membership rows — and the organizations
-- those memberships point at — before selecting an organization, without any
-- request-path RLS bypass. Writes stay strictly organization-scoped, except that
-- a user may update their own membership row (used for INVITED -> ACTIVE
-- self-activation; column-level rules stay in application code).
-- ---------------------------------------------------------------------------
DROP POLICY core_organization_memberships_tenant ON core_organization_memberships;

CREATE POLICY core_organization_memberships_select ON core_organization_memberships
  FOR SELECT
  USING (
    app_bypass_rls()
    OR organization_id = app_current_organization_id()
    OR user_id = app_current_user_id()
  );

CREATE POLICY core_organization_memberships_insert ON core_organization_memberships
  FOR INSERT
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_organization_id());

CREATE POLICY core_organization_memberships_update ON core_organization_memberships
  FOR UPDATE
  USING (
    app_bypass_rls()
    OR organization_id = app_current_organization_id()
    OR user_id = app_current_user_id()
  )
  WITH CHECK (
    app_bypass_rls()
    OR organization_id = app_current_organization_id()
    OR user_id = app_current_user_id()
  );

CREATE POLICY core_organization_memberships_delete ON core_organization_memberships
  FOR DELETE
  USING (app_bypass_rls() OR organization_id = app_current_organization_id());

DROP POLICY core_organizations_tenant ON core_organizations;

CREATE POLICY core_organizations_select ON core_organizations
  FOR SELECT
  USING (
    app_bypass_rls()
    OR id = app_current_organization_id()
    OR id IN (
      SELECT m.organization_id
      FROM core_organization_memberships m
      WHERE m.user_id = app_current_user_id()
    )
  );

CREATE POLICY core_organizations_insert ON core_organizations
  FOR INSERT
  WITH CHECK (app_bypass_rls() OR id = app_current_organization_id());

CREATE POLICY core_organizations_update ON core_organizations
  FOR UPDATE
  USING (app_bypass_rls() OR id = app_current_organization_id())
  WITH CHECK (app_bypass_rls() OR id = app_current_organization_id());

CREATE POLICY core_organizations_delete ON core_organizations
  FOR DELETE
  USING (app_bypass_rls() OR id = app_current_organization_id());

-- ---------------------------------------------------------------------------
-- Grants for the runtime role (auth_* tables were created after migration 0001
-- ran its GRANT ... ON ALL TABLES; default privileges may not apply when a
-- different role applies this migration).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gaming_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_users, auth_sessions, auth_accounts, auth_verifications TO gaming_app;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'gaming_app grants skipped (engine/privilege limitation): %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- Permission registry additions: read-level permissions for admin surfaces.
-- Manage permissions already exist from 0001.
-- ---------------------------------------------------------------------------
INSERT INTO core_permissions (code, module, name, description, risk_level) VALUES
  ('core.memberships.read', 'core', 'Read memberships', 'View organization users, their roles, and branch access', 'LOW'),
  ('core.roles.read', 'core', 'Read roles', 'View roles and their permissions', 'LOW');
