-- 0016_staff_access_revoke.sql
-- Purpose: Soft-revoke staff logins. Disable now; anonymize after 30 days on
-- next authentication. Does not physically DELETE core_users (created_by FKs
-- on payments, sessions, and expenses). Does not rewrite 0001–0015.

ALTER TABLE core_users
  ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_after timestamptz;

CREATE INDEX IF NOT EXISTS core_users_purge_after_idx
  ON core_users (purge_after)
  WHERE status = 'DISABLED' AND purge_after IS NOT NULL;
