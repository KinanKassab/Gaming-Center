-- 0003_security_hardening.sql
-- Purpose: Milestone 2.1 — identity & tenant security hardening.
--   1. Remove the GUC-based RLS bypass (app.bypass_rls / app_bypass_rls()).
--      Request-path role gaming_app must have no user-controlled skip for tenant RLS.
--      Migrations and administrative SQL use a separate privileged connection.
--   2. Narrow membership self-update: organization_id and user_id are immutable;
--      the only self-service write is INVITED → ACTIVE invitation activation.
--   3. Better Auth 1.7 identity uniqueness: UNIQUE (issuer, account_id).
--   4. Case-insensitive Core User email uniqueness where email is present.
-- Does not rewrite 0001 or 0002. Does not add gaming/POS/finance/cards tables.

-- ---------------------------------------------------------------------------
-- Duplicate-data guards (fail safely; do not merge or destroy rows)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dup_emails text;
  dup_accounts text;
BEGIN
  SELECT string_agg(email_key, ', ')
    INTO dup_emails
    FROM (
      SELECT lower(email) AS email_key
      FROM core_users
      WHERE email IS NOT NULL
      GROUP BY lower(email)
      HAVING count(*) > 1
    ) duplicates;

  IF dup_emails IS NOT NULL THEN
    RAISE EXCEPTION
      '0003_security_hardening aborted: duplicate core_users emails (case-insensitive): %. Remediate duplicates then re-run this migration. No rows were merged or deleted.',
      dup_emails;
  END IF;

  SELECT string_agg(issuer || '/' || account_id, ', ')
    INTO dup_accounts
    FROM (
      SELECT issuer, account_id
      FROM auth_accounts
      GROUP BY issuer, account_id
      HAVING count(*) > 1
    ) duplicates;

  IF dup_accounts IS NOT NULL THEN
    RAISE EXCEPTION
      '0003_security_hardening aborted: duplicate auth_accounts identities (issuer, account_id): %. Remediate duplicates then re-run this migration. No rows were merged or deleted.',
      dup_accounts;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Uniqueness invariants
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS core_users_email_lower_idx;

CREATE UNIQUE INDEX core_users_email_lower_key
  ON core_users (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX auth_accounts_issuer_account_id_key
  ON auth_accounts (issuer, account_id);

-- ---------------------------------------------------------------------------
-- Membership row invariants (trigger — RLS WITH CHECK cannot see OLD)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_membership_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'membership id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'membership organization_id is immutable';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'membership user_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'membership created_at is immutable';
  END IF;

  -- Self-service path: the session is not acting inside this organization.
  -- Organization-authorized admins set app.organization_id to this org.
  IF app_current_organization_id() IS DISTINCT FROM OLD.organization_id THEN
    IF app_current_user_id() IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'membership update rejected';
    END IF;
    IF NOT (
      OLD.status = 'INVITED'
      AND NEW.status = 'ACTIVE'
      AND NEW.joined_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'self-service membership update is limited to invitation activation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_core_organization_memberships_invariants
  ON core_organization_memberships;

CREATE TRIGGER trg_core_organization_memberships_invariants
  BEFORE UPDATE ON core_organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION enforce_membership_row_invariants();

-- ---------------------------------------------------------------------------
-- Drop every policy that referenced app_bypass_rls(), then recreate without it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS core_organizations_tenant ON core_organizations;
DROP POLICY IF EXISTS core_organizations_select ON core_organizations;
DROP POLICY IF EXISTS core_organizations_insert ON core_organizations;
DROP POLICY IF EXISTS core_organizations_update ON core_organizations;
DROP POLICY IF EXISTS core_organizations_delete ON core_organizations;

DROP POLICY IF EXISTS core_organization_memberships_tenant ON core_organization_memberships;
DROP POLICY IF EXISTS core_organization_memberships_select ON core_organization_memberships;
DROP POLICY IF EXISTS core_organization_memberships_insert ON core_organization_memberships;
DROP POLICY IF EXISTS core_organization_memberships_update ON core_organization_memberships;
DROP POLICY IF EXISTS core_organization_memberships_delete ON core_organization_memberships;

DROP POLICY IF EXISTS core_branches_tenant ON core_branches;
DROP POLICY IF EXISTS core_roles_tenant ON core_roles;
DROP POLICY IF EXISTS core_role_permissions_tenant ON core_role_permissions;
DROP POLICY IF EXISTS core_membership_roles_tenant ON core_membership_roles;
DROP POLICY IF EXISTS core_branch_access_tenant ON core_branch_access;
DROP POLICY IF EXISTS core_setting_values_tenant ON core_setting_values;
DROP POLICY IF EXISTS core_organization_features_tenant ON core_organization_features;
DROP POLICY IF EXISTS core_customers_tenant ON core_customers;
DROP POLICY IF EXISTS core_audit_logs_tenant ON core_audit_logs;
DROP POLICY IF EXISTS core_outbox_events_tenant ON core_outbox_events;
DROP POLICY IF EXISTS core_idempotency_keys_tenant ON core_idempotency_keys;

-- Organizations: read own memberships' orgs before selection; writes stay org-scoped.
CREATE POLICY core_organizations_select ON core_organizations
  FOR SELECT
  USING (
    id = app_current_organization_id()
    OR id IN (
      SELECT m.organization_id
      FROM core_organization_memberships m
      WHERE m.user_id = app_current_user_id()
    )
  );

CREATE POLICY core_organizations_insert ON core_organizations
  FOR INSERT
  WITH CHECK (id = app_current_organization_id());

CREATE POLICY core_organizations_update ON core_organizations
  FOR UPDATE
  USING (id = app_current_organization_id())
  WITH CHECK (id = app_current_organization_id());

CREATE POLICY core_organizations_delete ON core_organizations
  FOR DELETE
  USING (id = app_current_organization_id());

-- Memberships: org-scoped writes; self SELECT; self UPDATE only INVITED → ACTIVE.
CREATE POLICY core_organization_memberships_select ON core_organization_memberships
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR user_id = app_current_user_id()
  );

CREATE POLICY core_organization_memberships_insert ON core_organization_memberships
  FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_organization_memberships_update_org ON core_organization_memberships
  FOR UPDATE
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_organization_memberships_update_self ON core_organization_memberships
  FOR UPDATE
  USING (
    user_id = app_current_user_id()
    AND status = 'INVITED'
  )
  WITH CHECK (
    user_id = app_current_user_id()
    AND status = 'ACTIVE'
  );

CREATE POLICY core_organization_memberships_delete ON core_organization_memberships
  FOR DELETE
  USING (organization_id = app_current_organization_id());

CREATE POLICY core_branches_tenant ON core_branches
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_roles_tenant ON core_roles
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_role_permissions_tenant ON core_role_permissions
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_membership_roles_tenant ON core_membership_roles
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_branch_access_tenant ON core_branch_access
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_setting_values_tenant ON core_setting_values
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_organization_features_tenant ON core_organization_features
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_customers_tenant ON core_customers
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_audit_logs_tenant ON core_audit_logs
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_outbox_events_tenant ON core_outbox_events
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY core_idempotency_keys_tenant ON core_idempotency_keys
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- Remove the dangerous bypass function after no policy depends on it.
DROP FUNCTION IF EXISTS app_bypass_rls();

-- ---------------------------------------------------------------------------
-- Runtime role: never superuser, never BYPASSRLS, never a skip-GUC.
-- Privileged DDL remains on the migration/admin connection (table owner).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gaming_app') THEN
    ALTER ROLE gaming_app WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  ELSE
    RAISE EXCEPTION 'gaming_app role is required after 0003; create it before applying this migration on engines that skipped 0001 role creation';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Could not ALTER ROLE gaming_app (insufficient privilege on this connection): %', SQLERRM;
  WHEN undefined_object THEN
    RAISE EXCEPTION 'gaming_app role is required after 0003';
  WHEN OTHERS THEN
    -- PGlite / limited engines: keep going only if the role exists.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gaming_app') THEN
      RAISE;
    END IF;
    RAISE NOTICE 'ALTER ROLE gaming_app skipped (engine/privilege limitation): %', SQLERRM;
END $$;

GRANT EXECUTE ON FUNCTION enforce_membership_row_invariants() TO gaming_app;
