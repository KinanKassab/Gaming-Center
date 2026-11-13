-- 0012_platform_bootstrap.sql
-- Purpose: Platform adaptation — one-time first-owner bootstrap lock.
-- Forward-safe. Does not rewrite 0001–0011.
--
-- Public HTTP sign-up and self-serve organization creation must fail closed
-- after the first identity / first organization exist. A singleton row makes
-- concurrent first-user and first-organization claims serialize with a
-- transaction-scoped UPDATE (compatible with Supavisor transaction pooling;
-- no session-level advisory locks).
--
-- This table is platform-level (like core_users): no RLS. It holds no tenant
-- payload. gaming_app may SELECT/UPDATE the singleton; INSERT/DELETE are
-- revoked so a second row cannot be created at runtime.
--
-- Better Auth tables are not written here. First-user creation remains
-- auth.api.signUpEmail / the HTTP handler.

CREATE TABLE core_platform_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT TRUE,
  signup_claimed_at timestamptz,
  first_core_user_id uuid REFERENCES core_users (id),
  first_organization_id uuid REFERENCES core_organizations (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_platform_bootstrap_singleton_chk CHECK (singleton)
);

INSERT INTO core_platform_bootstrap (singleton) VALUES (TRUE);

-- Existing hosted databases that already have identities/organizations must
-- fail closed immediately; do not reopen public HTTP sign-up.
UPDATE core_platform_bootstrap
SET
  signup_claimed_at = COALESCE(signup_claimed_at, now()),
  first_core_user_id = COALESCE(
    first_core_user_id,
    (SELECT id FROM core_users ORDER BY created_at ASC, id ASC LIMIT 1)
  )
WHERE EXISTS (SELECT 1 FROM core_users);

UPDATE core_platform_bootstrap
SET first_organization_id = COALESCE(
  first_organization_id,
  (SELECT id FROM core_organizations ORDER BY created_at ASC, id ASC LIMIT 1)
)
WHERE EXISTS (SELECT 1 FROM core_organizations);

GRANT SELECT, UPDATE ON core_platform_bootstrap TO gaming_app;
REVOKE INSERT, DELETE ON core_platform_bootstrap FROM gaming_app;

DO $$
DECLARE
  target text;
  targets text[] := ARRAY['anon', 'authenticated', 'service_role'];
BEGIN
  FOREACH target IN ARRAY targets
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target) THEN
      EXECUTE format('REVOKE ALL ON TABLE core_platform_bootstrap FROM %I', target);
    END IF;
  END LOOP;
END $$;
