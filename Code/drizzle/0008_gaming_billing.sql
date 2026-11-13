-- 0008_gaming_billing.sql
-- Purpose: Milestone 6 — gaming billing finalization fields and one-time
-- fill of existing amount placeholders. Forward-safe. Does not rewrite 0001–0007.
-- Does not add POS, payments, charges, refunds, tax, discounts, or cards_*.
--
-- Source of truth for a finalized total: gaming_sessions.gaming_total_minor
-- plus per-segment computed_amount_minor, captured billing_breakdown, and
-- billing_finalized_at. Historical pricing remains the immutable segment snapshot.
--
-- Closed COMPLETED rows may receive a one-time billing fill when amounts are NULL.
-- CANCELLED rows stay fully immutable. Finalized amounts cannot be overwritten.

ALTER TABLE gaming_sessions
  ADD COLUMN billing_finalized_at timestamptz,
  ADD COLUMN billing_rule_version text,
  ADD COLUMN billing_currency char(3),
  ADD COLUMN billing_breakdown jsonb;

ALTER TABLE gaming_sessions
  ADD CONSTRAINT gaming_sessions_billing_currency_chk
    CHECK (billing_currency IS NULL OR billing_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT gaming_sessions_billing_shape_chk
    CHECK (
      (
        billing_finalized_at IS NULL
        AND billing_rule_version IS NULL
        AND billing_currency IS NULL
        AND billing_breakdown IS NULL
        AND gaming_total_minor IS NULL
      )
      OR (
        status = 'COMPLETED'
        AND billing_finalized_at IS NOT NULL
        AND billing_rule_version IS NOT NULL
        AND char_length(btrim(billing_rule_version)) > 0
        AND billing_currency IS NOT NULL
        AND billing_breakdown IS NOT NULL
        AND gaming_total_minor IS NOT NULL
        AND gaming_total_minor >= 0
      )
    );

CREATE INDEX idx_gaming_sessions_org_branch_unbilled
  ON gaming_sessions (organization_id, branch_id, ended_at DESC)
  WHERE status = 'COMPLETED' AND billing_finalized_at IS NULL;

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

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'closed session rows are immutable';
  END IF;

  IF OLD.status = 'COMPLETED' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.current_device_id IS DISTINCT FROM OLD.current_device_id
      OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
      OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
      OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    THEN
      RAISE EXCEPTION 'closed session rows are immutable';
    END IF;
    IF OLD.charge_id IS NOT NULL AND NEW.charge_id IS DISTINCT FROM OLD.charge_id THEN
      RAISE EXCEPTION 'charge_id is immutable once set';
    END IF;
    IF OLD.gaming_total_minor IS NOT NULL AND NEW.gaming_total_minor IS DISTINCT FROM OLD.gaming_total_minor THEN
      RAISE EXCEPTION 'finalized gaming_total_minor is immutable';
    END IF;
    IF OLD.billing_finalized_at IS NOT NULL AND NEW.billing_finalized_at IS DISTINCT FROM OLD.billing_finalized_at THEN
      RAISE EXCEPTION 'billing_finalized_at is immutable once set';
    END IF;
    IF OLD.billing_rule_version IS NOT NULL AND NEW.billing_rule_version IS DISTINCT FROM OLD.billing_rule_version THEN
      RAISE EXCEPTION 'billing_rule_version is immutable once set';
    END IF;
    IF OLD.billing_currency IS NOT NULL AND NEW.billing_currency IS DISTINCT FROM OLD.billing_currency THEN
      RAISE EXCEPTION 'billing_currency is immutable once set';
    END IF;
    IF OLD.billing_breakdown IS NOT NULL AND NEW.billing_breakdown IS DISTINCT FROM OLD.billing_breakdown THEN
      RAISE EXCEPTION 'billing_breakdown is immutable once set';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

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
    IF NEW.ended_at IS DISTINCT FROM OLD.ended_at
      OR NEW.end_reason IS DISTINCT FROM OLD.end_reason
    THEN
      RAISE EXCEPTION 'closed session segment rows are immutable';
    END IF;
    IF OLD.computed_amount_minor IS NOT NULL
      AND NEW.computed_amount_minor IS DISTINCT FROM OLD.computed_amount_minor
    THEN
      RAISE EXCEPTION 'segment computed_amount_minor is immutable once set';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
