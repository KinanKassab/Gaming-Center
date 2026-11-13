-- 0010_pilot_hardening.sql
-- Purpose: Milestone 8 — least-privilege for the runtime role after 0001–0009.
-- Forward-safe. Does not rewrite 0001–0009.
--
-- 0001 granted SELECT, INSERT, UPDATE, DELETE on all public tables to
-- gaming_app, including append-only audit/history and archive-only masters.
-- 0007/0009 already revoked DELETE on session history and finance tables.
-- This migration revokes DELETE on remaining tables the application never
-- deletes, and stops default privileges from granting DELETE on future tables.
--
-- DELETE is retained only where the application issues DELETE:
--   core_setting_values, core_branch_access, core_role_permissions,
--   core_membership_roles, auth_sessions, auth_accounts, auth_verifications.
--
-- CREATE on schema public is revoked. USAGE remains.

REVOKE CREATE ON SCHEMA public FROM gaming_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE DELETE ON TABLES FROM gaming_app;

REVOKE DELETE ON
  core_audit_logs,
  core_outbox_events,
  core_idempotency_keys,
  core_organizations,
  core_branches,
  core_users,
  core_organization_memberships,
  core_roles,
  core_permissions,
  core_features,
  core_organization_features,
  core_settings_definitions,
  core_customers,
  gaming_areas,
  gaming_device_types,
  gaming_devices,
  gaming_pricing_plans,
  gaming_pricing_assignments,
  auth_users
FROM gaming_app;

REVOKE UPDATE ON core_audit_logs FROM gaming_app;
