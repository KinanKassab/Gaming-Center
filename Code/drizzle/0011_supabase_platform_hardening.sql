-- 0011_supabase_platform_hardening.sql
-- Purpose: Platform adaptation — defense-in-depth against Supabase Data API roles.
-- Forward-safe. Does not rewrite 0001–0010.
--
-- Runtime data access remains: Browser → Next.js → Better Auth → gaming_app → RLS.
-- This migration does not enable or use anon / authenticated / service_role.
--
-- Portable:
--   * Ordinary local PostgreSQL (those roles absent): no-op, does not fail.
--   * Hosted Supabase (roles present): revoke application-schema privileges
--     on public tables, sequences, and functions from those roles.
--
-- Does not touch Supabase-managed schemas (auth, storage, realtime, extensions,
-- graphql, supabase_functions, vault, ...).
-- Does not DROP or ALTER Supabase platform roles.
--
-- Default-privilege hardening applies only to objects created by the current
-- migration role. If the Dashboard still grants default privileges as another
-- role, disable the Data API in the Supabase project settings (see
-- docs/operations/VERCEL_SUPABASE_DEPLOYMENT.md).

DO $$
DECLARE
  target text;
  targets text[] := ARRAY['anon', 'authenticated', 'service_role'];
BEGIN
  FOREACH target IN ARRAY targets
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', target);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', target);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', target);
      BEGIN
        EXECUTE format('REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM %I', target);
      EXCEPTION
        WHEN OTHERS THEN
          RAISE NOTICE '0011: procedure revoke skipped for %: %', target, SQLERRM;
      END;

      BEGIN
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', target);
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', target);
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', target);
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE NOTICE '0011: could not ALTER DEFAULT PRIVILEGES for % from this migration role; set Dashboard default privileges / disable Data API', target;
        WHEN OTHERS THEN
          RAISE NOTICE '0011: default privilege revoke skipped for %: %', target, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;
