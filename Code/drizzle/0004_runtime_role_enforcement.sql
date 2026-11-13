-- 0004_runtime_role_enforcement.sql
-- Purpose: Milestone 2 closure — fail closed if gaming_app cannot be pinned.
-- Does not rewrite 0001, 0002, or 0003.
--
-- Required runtime attributes:
--   NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN
--
-- Production model:
--   A) the privileged migration/provisioning role can ALTER ROLE gaming_app, or
--   B) this migration aborts with an actionable error if the role is unsafe.
-- A refused ALTER ROLE is not treated as success. An already-safe role is
-- accepted. getSafeRuntimeDb() remains defense in depth, not provisioning.

DO $$
DECLARE
  r record;
  alter_ok boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gaming_app') THEN
    RAISE EXCEPTION
      '0004_runtime_role_enforcement aborted: role gaming_app does not exist. Create LOGIN role gaming_app as NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT, then re-run migrations with a connection that can ALTER ROLE gaming_app.';
  END IF;

  BEGIN
    ALTER ROLE gaming_app WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
    alter_ok := true;
  EXCEPTION
    WHEN insufficient_privilege THEN
      alter_ok := false;
    WHEN OTHERS THEN
      -- PGlite / limited engines: do not assume the role was pinned.
      alter_ok := false;
  END;

  SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
    INTO r
    FROM pg_roles
    WHERE rolname = 'gaming_app';

  IF r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR NOT r.rolcanlogin THEN
    RAISE EXCEPTION
      '0004_runtime_role_enforcement aborted: gaming_app is unsafe (rolsuper=%, rolbypassrls=%, rolcreatedb=%, rolcreaterole=%, rolinherit=%, rolcanlogin=%). ALTER ROLE %. Do not assume a refused ALTER ROLE pinned the role. The privileged migration/provisioning role must ALTER ROLE gaming_app to NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN, or the role must already have those attributes. getSafeRuntimeDb() is not a substitute for provisioning.',
      r.rolsuper,
      r.rolbypassrls,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolinherit,
      r.rolcanlogin,
      CASE WHEN alter_ok THEN 'reported success but pg_roles is still unsafe' ELSE 'did not succeed on this connection' END;
  END IF;
END $$;
