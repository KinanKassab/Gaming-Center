-- 0007_gaming_sessions.sql
-- Purpose: Milestone 5 — gaming sessions, segments, pauses, occupancy.
-- Forward-safe. Does not rewrite 0001–0006.
-- Does not calculate charges, POS, payments, inventory, or cards_*.
-- Occupancy is derived from ACTIVE/PAUSED sessions, not device.operational_status.
--
-- Concurrency: SELECT ... FOR UPDATE on the device (and branch for numbering)
-- plus partial unique index uq_gaming_sessions_one_active_per_device.
-- Move locks the session, then current and target devices in UUID order.
--
-- 1. gaming.sessions.read / .start / .operate / .cancel; OWNER backfill.
-- 2. Branch-owned sessions, segments, pauses; composite tenant FKs; RLS.
-- 3. Immutable ownership; lifecycle CHECKs; no RLS bypass.

-- ---------------------------------------------------------------------------
-- Permission registry
-- ---------------------------------------------------------------------------
INSERT INTO core_permissions (code, module, name, description, risk_level) VALUES
  ('gaming.sessions.read', 'gaming', 'Read gaming sessions', 'View the gaming floor and session history', 'LOW'),
  ('gaming.sessions.start', 'gaming', 'Start gaming sessions', 'Start a session on an eligible device', 'MEDIUM'),
  ('gaming.sessions.operate', 'gaming', 'Operate gaming sessions', 'Pause, resume, move, end, or assign a customer', 'MEDIUM'),
  ('gaming.sessions.cancel', 'gaming', 'Cancel gaming sessions', 'Cancel a session with a required reason and audit', 'HIGH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core_role_permissions (organization_id, role_id, permission_code)
SELECT r.organization_id, r.id, p.code
FROM core_roles r
CROSS JOIN (
  VALUES
    ('gaming.sessions.read'),
    ('gaming.sessions.start'),
    ('gaming.sessions.operate'),
    ('gaming.sessions.cancel')
) AS p(code)
WHERE r.is_system = true
  AND r.code = 'OWNER'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- gaming_sessions (branch-owned operational record)
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_sessions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  session_number text NOT NULL,
  customer_id uuid,
  session_type text NOT NULL,
  status text NOT NULL,
  current_device_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  requested_end_at timestamptz,
  ended_at timestamptz,
  gaming_total_minor bigint,
  charge_id uuid,
  created_by uuid NOT NULL REFERENCES core_users (id),
  closed_by uuid REFERENCES core_users (id),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaming_sessions_type_chk
    CHECK (session_type IN ('OPEN', 'FIXED')),
  CONSTRAINT gaming_sessions_status_chk
    CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDING', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT gaming_sessions_number_chk
    CHECK (session_number ~ '^[1-9][0-9]*$'),
  CONSTRAINT gaming_sessions_fixed_chk
    CHECK (
      (session_type = 'OPEN' AND requested_end_at IS NULL)
      OR (session_type = 'FIXED' AND requested_end_at IS NOT NULL AND requested_end_at > started_at)
    ),
  CONSTRAINT gaming_sessions_lifecycle_chk
    CHECK (
      (
        status IN ('ACTIVE', 'PAUSED')
        AND current_device_id IS NOT NULL
        AND ended_at IS NULL
        AND closed_by IS NULL
        AND cancel_reason IS NULL
      )
      OR (
        status = 'ENDING'
        AND ended_at IS NULL
        AND cancel_reason IS NULL
      )
      OR (
        status = 'COMPLETED'
        AND current_device_id IS NULL
        AND ended_at IS NOT NULL
        AND ended_at >= started_at
        AND cancel_reason IS NULL
      )
      OR (
        status = 'CANCELLED'
        AND current_device_id IS NULL
        AND ended_at IS NOT NULL
        AND ended_at >= started_at
        AND cancel_reason IS NOT NULL
        AND char_length(btrim(cancel_reason)) > 0
      )
    ),
  CONSTRAINT gaming_sessions_total_chk
    CHECK (gaming_total_minor IS NULL OR gaming_total_minor >= 0),
  CONSTRAINT gaming_sessions_org_branch_number_key
    UNIQUE (organization_id, branch_id, session_number),
  CONSTRAINT gaming_sessions_id_org_key
    UNIQUE (id, organization_id),
  CONSTRAINT gaming_sessions_id_org_branch_key
    UNIQUE (id, organization_id, branch_id),
  CONSTRAINT gaming_sessions_branch_tenant_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT gaming_sessions_device_tenant_fk
    FOREIGN KEY (current_device_id, organization_id, branch_id)
    REFERENCES gaming_devices (id, organization_id, branch_id),
  CONSTRAINT gaming_sessions_customer_tenant_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES core_customers (id, organization_id)
);

CREATE UNIQUE INDEX uq_gaming_sessions_one_active_per_device
  ON gaming_sessions (current_device_id)
  WHERE current_device_id IS NOT NULL
    AND status IN ('ACTIVE', 'PAUSED');

CREATE INDEX idx_gaming_sessions_org_branch_started
  ON gaming_sessions (organization_id, branch_id, started_at DESC);

CREATE INDEX idx_gaming_sessions_org_branch_status_started
  ON gaming_sessions (organization_id, branch_id, status, started_at DESC);

CREATE INDEX idx_gaming_sessions_org_customer
  ON gaming_sessions (organization_id, customer_id)
  WHERE customer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- gaming_session_segments (device + pricing slice; snapshot is historical)
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_session_segments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  session_id uuid NOT NULL,
  device_id uuid NOT NULL,
  pricing_plan_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  pricing_snapshot jsonb NOT NULL,
  computed_amount_minor bigint,
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaming_session_segments_times_chk
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT gaming_session_segments_end_reason_chk
    CHECK (
      (ended_at IS NULL AND end_reason IS NULL)
      OR (
        ended_at IS NOT NULL
        AND end_reason IN ('MOVE', 'PRICE_CHANGE', 'SESSION_END', 'CANCEL')
      )
    ),
  CONSTRAINT gaming_session_segments_amount_chk
    CHECK (computed_amount_minor IS NULL OR computed_amount_minor >= 0),
  CONSTRAINT gaming_session_segments_id_org_key
    UNIQUE (id, organization_id),
  CONSTRAINT gaming_session_segments_branch_tenant_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT gaming_session_segments_session_tenant_fk
    FOREIGN KEY (session_id, organization_id, branch_id)
    REFERENCES gaming_sessions (id, organization_id, branch_id),
  CONSTRAINT gaming_session_segments_device_tenant_fk
    FOREIGN KEY (device_id, organization_id, branch_id)
    REFERENCES gaming_devices (id, organization_id, branch_id),
  CONSTRAINT gaming_session_segments_plan_tenant_fk
    FOREIGN KEY (pricing_plan_id, organization_id)
    REFERENCES gaming_pricing_plans (id, organization_id)
);

CREATE UNIQUE INDEX uq_gaming_session_segments_one_open
  ON gaming_session_segments (session_id)
  WHERE ended_at IS NULL;

CREATE INDEX idx_gaming_session_segments_session_started
  ON gaming_session_segments (session_id, started_at);

-- ---------------------------------------------------------------------------
-- gaming_session_pauses (pause/resume facts; is_billable is stored, not priced)
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_session_pauses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  session_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  is_billable boolean NOT NULL DEFAULT false,
  reason text,
  created_by uuid NOT NULL REFERENCES core_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaming_session_pauses_times_chk
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT gaming_session_pauses_id_org_key
    UNIQUE (id, organization_id),
  CONSTRAINT gaming_session_pauses_branch_tenant_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT gaming_session_pauses_session_tenant_fk
    FOREIGN KEY (session_id, organization_id, branch_id)
    REFERENCES gaming_sessions (id, organization_id, branch_id)
);

CREATE UNIQUE INDEX uq_gaming_session_pauses_one_open
  ON gaming_session_pauses (session_id)
  WHERE ended_at IS NULL;

CREATE INDEX idx_gaming_session_pauses_session_started
  ON gaming_session_pauses (session_id, started_at);

-- ---------------------------------------------------------------------------
-- Immutable ownership and closed-record protection
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_gaming_session_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'session id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'session organization_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'session branch_id is immutable';
  END IF;
  IF NEW.session_number IS DISTINCT FROM OLD.session_number THEN
    RAISE EXCEPTION 'session session_number is immutable';
  END IF;
  IF NEW.session_type IS DISTINCT FROM OLD.session_type THEN
    RAISE EXCEPTION 'session session_type is immutable';
  END IF;
  IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'session started_at is immutable';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'session created_by is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'session created_at is immutable';
  END IF;
  IF NEW.requested_end_at IS DISTINCT FROM OLD.requested_end_at THEN
    RAISE EXCEPTION 'session requested_end_at is immutable';
  END IF;
  IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'closed session rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gaming_sessions_invariants
  BEFORE UPDATE ON gaming_sessions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_gaming_session_row_invariants();

CREATE OR REPLACE FUNCTION enforce_gaming_session_segment_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'session segment id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'session segment organization_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'session segment branch_id is immutable';
  END IF;
  IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'session segment session_id is immutable';
  END IF;
  IF NEW.device_id IS DISTINCT FROM OLD.device_id THEN
    RAISE EXCEPTION 'session segment device_id is immutable';
  END IF;
  IF NEW.pricing_plan_id IS DISTINCT FROM OLD.pricing_plan_id THEN
    RAISE EXCEPTION 'session segment pricing_plan_id is immutable';
  END IF;
  IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'session segment started_at is immutable';
  END IF;
  IF NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot THEN
    RAISE EXCEPTION 'session segment pricing_snapshot is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'session segment created_at is immutable';
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'closed session segment rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gaming_session_segments_invariants
  BEFORE UPDATE ON gaming_session_segments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_gaming_session_segment_row_invariants();

CREATE OR REPLACE FUNCTION enforce_gaming_session_pause_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'session pause id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'session pause organization_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'session pause branch_id is immutable';
  END IF;
  IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'session pause session_id is immutable';
  END IF;
  IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'session pause started_at is immutable';
  END IF;
  IF NEW.is_billable IS DISTINCT FROM OLD.is_billable THEN
    RAISE EXCEPTION 'session pause is_billable is immutable';
  END IF;
  IF NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'session pause reason is immutable';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'session pause created_by is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'session pause created_at is immutable';
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'closed session pause rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gaming_session_pauses_invariants
  BEFORE UPDATE ON gaming_session_pauses
  FOR EACH ROW
  EXECUTE FUNCTION enforce_gaming_session_pause_row_invariants();

-- ---------------------------------------------------------------------------
-- RLS — tenant match only. No bypass GUC or function.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gaming_sessions',
    'gaming_session_segments',
    'gaming_session_pauses'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY gaming_sessions_tenant ON gaming_sessions
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY gaming_session_segments_tenant ON gaming_session_segments
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY gaming_session_pauses_tenant ON gaming_session_pauses
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE ON
  gaming_sessions,
  gaming_session_segments,
  gaming_session_pauses
TO gaming_app;

GRANT EXECUTE ON FUNCTION enforce_gaming_session_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_gaming_session_segment_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_gaming_session_pause_row_invariants() TO gaming_app;
