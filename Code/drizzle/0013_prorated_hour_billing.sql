-- 0013_prorated_hour_billing.sql
-- Purpose: Distinguish legacy unit-based TIME_BASED billing from the approved
-- prorated hourly model (nearest 5 minutes, nearest 5 currency units).
-- Forward-safe. Does not rewrite 0001–0012. Does not touch historical snapshots
-- or finalized session totals.
--
-- Existing rows default to UNIT so CEIL/FLOOR/NEAREST per billing_unit_seconds
-- stays deterministic. New owner-created hourly plans use PRORATED_HOUR.
-- Calculation constants (5 minutes, 5 currency units, 3600s hour) are snapshotted
-- onto the session segment at start — not inferred later from this column alone.
--
-- No new tables. FORCE RLS and gaming_app grants on gaming_pricing_plans are
-- unchanged; the new column inherits existing table privileges.

ALTER TABLE gaming_pricing_plans
  ADD COLUMN time_billing_mode text NOT NULL DEFAULT 'UNIT';

ALTER TABLE gaming_pricing_plans
  ADD CONSTRAINT gaming_pricing_plans_time_billing_mode_chk
    CHECK (time_billing_mode IN ('UNIT', 'PRORATED_HOUR')),
  ADD CONSTRAINT gaming_pricing_plans_time_billing_model_chk
    CHECK (pricing_model <> 'PACKAGE' OR time_billing_mode = 'UNIT');
