-- 0009_finance_checkout.sql
-- Purpose: Milestone 7 — checkout and payment recording for finalized M6 bills.
-- Forward-safe. Does not rewrite 0001–0008.
-- Does not add POS catalog, inventory, cash shifts, expenses, refunds, or cards_*.
--
-- Canonical amount due is the finalized M6 session bill:
--   gaming_sessions.gaming_total_minor + billing_currency + billing_finalized_at
-- Payments copy that total onto finance_charges. They never recalculate pricing.
--
-- Concurrency: record-payment locks the session row FOR UPDATE, then the charge
-- row FOR UPDATE, recomputes applied allocations, inserts payment + allocation.
-- Constraint trigger rejects allocated total > charge.total_minor.
-- Idempotency: core_idempotency_keys UNIQUE (organization_id, scope, key)
-- with scope finance.payments. Exact retry returns the stored payment.
--
-- 1. finance.payments.read / .create; OWNER backfill.
-- 2. Payment methods, charges/items, payments, allocations; composite FKs; RLS.
-- 3. Session charge_id FK; financial DELETE hardening for gaming_app.
-- 4. Seed CASH (CASH) and SHAMCASH (MANUAL record). No provider API.

-- ---------------------------------------------------------------------------
-- Permission registry
-- ---------------------------------------------------------------------------
INSERT INTO core_permissions (code, module, name, description, risk_level) VALUES
  ('finance.payments.read', 'finance', 'Read payments', 'View checkout state and payment history', 'LOW'),
  ('finance.payments.create', 'finance', 'Record payments', 'Record a payment against a finalized gaming bill', 'HIGH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core_role_permissions (organization_id, role_id, permission_code)
SELECT r.organization_id, r.id, p.code
FROM core_roles r
CROSS JOIN (
  VALUES
    ('finance.payments.read'),
    ('finance.payments.create')
) AS p(code)
WHERE r.is_system = true
  AND r.code = 'OWNER'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- finance_payment_methods (organization-owned)
-- ---------------------------------------------------------------------------
CREATE TABLE finance_payment_methods (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  code text NOT NULL,
  name text NOT NULL,
  method_type text NOT NULL,
  requires_reference boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_payment_methods_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT finance_payment_methods_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT finance_payment_methods_code_chk
    CHECK (char_length(btrim(code)) > 0 AND code = upper(code)),
  CONSTRAINT finance_payment_methods_name_chk
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT finance_payment_methods_type_chk
    CHECK (method_type IN ('CASH', 'MANUAL', 'INTEGRATED', 'WALLET')),
  CONSTRAINT finance_payment_methods_status_chk
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX finance_payment_methods_org_status_idx
  ON finance_payment_methods (organization_id, status);

-- ---------------------------------------------------------------------------
-- finance_charges (branch-owned obligation; total copied from M6, not recalculated)
-- ---------------------------------------------------------------------------
CREATE TABLE finance_charges (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  customer_id uuid,
  source_module text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  status text NOT NULL,
  currency char(3) NOT NULL,
  subtotal_minor bigint NOT NULL,
  discount_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  created_by uuid REFERENCES core_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_charges_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT finance_charges_id_org_branch_key UNIQUE (id, organization_id, branch_id),
  CONSTRAINT finance_charges_source_key UNIQUE (organization_id, source_module, source_type, source_id),
  CONSTRAINT finance_charges_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT finance_charges_customer_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES core_customers (id, organization_id),
  CONSTRAINT finance_charges_source_module_chk
    CHECK (source_module IN ('gaming', 'pos', 'manual_adjustment')),
  CONSTRAINT finance_charges_source_type_chk
    CHECK (char_length(btrim(source_type)) > 0),
  CONSTRAINT finance_charges_status_chk
    CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID')),
  CONSTRAINT finance_charges_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_charges_money_chk
    CHECK (
      subtotal_minor >= 0
      AND discount_minor >= 0
      AND tax_minor >= 0
      AND total_minor >= 0
      AND total_minor = subtotal_minor - discount_minor + tax_minor
    )
);

CREATE INDEX finance_charges_org_branch_issued_idx
  ON finance_charges (organization_id, branch_id, issued_at DESC);

CREATE INDEX finance_charges_org_customer_status_idx
  ON finance_charges (organization_id, customer_id, status, issued_at DESC);

-- ---------------------------------------------------------------------------
-- finance_charge_items
-- ---------------------------------------------------------------------------
CREATE TABLE finance_charge_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  charge_id uuid NOT NULL,
  item_type text NOT NULL,
  description_snapshot text NOT NULL,
  quantity numeric(18, 3) NOT NULL,
  unit_amount_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  source_type text,
  source_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_charge_items_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT finance_charge_items_charge_fk
    FOREIGN KEY (charge_id, organization_id)
    REFERENCES finance_charges (id, organization_id),
  CONSTRAINT finance_charge_items_item_type_chk
    CHECK (char_length(btrim(item_type)) > 0),
  CONSTRAINT finance_charge_items_description_chk
    CHECK (char_length(btrim(description_snapshot)) > 0),
  CONSTRAINT finance_charge_items_quantity_chk
    CHECK (quantity > 0),
  CONSTRAINT finance_charge_items_money_chk
    CHECK (unit_amount_minor >= 0 AND total_minor >= 0)
);

CREATE INDEX finance_charge_items_org_charge_idx
  ON finance_charge_items (organization_id, charge_id);

-- ---------------------------------------------------------------------------
-- finance_payments (append-only completed records)
-- ---------------------------------------------------------------------------
CREATE TABLE finance_payments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  customer_id uuid,
  payment_method_id uuid NOT NULL,
  status text NOT NULL,
  currency char(3) NOT NULL,
  amount_minor bigint NOT NULL,
  external_reference text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES core_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_payments_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT finance_payments_id_org_branch_key UNIQUE (id, organization_id, branch_id),
  CONSTRAINT finance_payments_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT finance_payments_customer_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES core_customers (id, organization_id),
  CONSTRAINT finance_payments_method_fk
    FOREIGN KEY (payment_method_id, organization_id)
    REFERENCES finance_payment_methods (id, organization_id),
  CONSTRAINT finance_payments_status_chk
    CHECK (status IN ('COMPLETED')),
  CONSTRAINT finance_payments_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_payments_amount_chk
    CHECK (amount_minor > 0),
  CONSTRAINT finance_payments_reference_chk
    CHECK (external_reference IS NULL OR char_length(btrim(external_reference)) > 0)
);

CREATE INDEX finance_payments_org_branch_received_idx
  ON finance_payments (organization_id, branch_id, received_at DESC);

CREATE INDEX finance_payments_org_external_reference_idx
  ON finance_payments (organization_id, external_reference);

-- ---------------------------------------------------------------------------
-- finance_payment_allocations
-- ---------------------------------------------------------------------------
CREATE TABLE finance_payment_allocations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  payment_id uuid NOT NULL,
  charge_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_payment_allocations_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT finance_payment_allocations_payment_fk
    FOREIGN KEY (payment_id, organization_id)
    REFERENCES finance_payments (id, organization_id),
  CONSTRAINT finance_payment_allocations_charge_fk
    FOREIGN KEY (charge_id, organization_id)
    REFERENCES finance_charges (id, organization_id),
  CONSTRAINT finance_payment_allocations_amount_chk
    CHECK (amount_minor > 0)
);

CREATE INDEX finance_payment_allocations_payment_idx
  ON finance_payment_allocations (payment_id);

CREATE INDEX finance_payment_allocations_charge_idx
  ON finance_payment_allocations (charge_id);

-- Session charge_id now references a real charge when set.
ALTER TABLE gaming_sessions
  ADD CONSTRAINT gaming_sessions_charge_fk
  FOREIGN KEY (charge_id, organization_id, branch_id)
  REFERENCES finance_charges (id, organization_id, branch_id);

-- ---------------------------------------------------------------------------
-- Seed default methods for existing organizations (CASH + manual ShamCash)
-- ---------------------------------------------------------------------------
INSERT INTO finance_payment_methods (
  id, organization_id, code, name, method_type, requires_reference, status, config
)
SELECT gen_random_uuid(), o.id, 'CASH', 'Cash', 'CASH', false, 'ACTIVE', NULL
FROM core_organizations o
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO finance_payment_methods (
  id, organization_id, code, name, method_type, requires_reference, status, config
)
SELECT
  gen_random_uuid(),
  o.id,
  'SHAMCASH',
  'ShamCash',
  'MANUAL',
  false,
  'ACTIVE',
  '{"recordingMode":"MANUAL","integration":"NEEDS_VERIFICATION"}'::jsonb
FROM core_organizations o
ON CONFLICT (organization_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Immutability + allocation cap
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_finance_payment_method_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'payment method id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'payment method organization_id is immutable';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'payment method code is immutable';
  END IF;
  IF NEW.method_type IS DISTINCT FROM OLD.method_type THEN
    RAISE EXCEPTION 'payment method method_type is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'payment method created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_payment_methods_invariants
  BEFORE UPDATE ON finance_payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION enforce_finance_payment_method_row_invariants();

CREATE OR REPLACE FUNCTION enforce_finance_charge_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'charge id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'charge organization_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'charge branch_id is immutable';
  END IF;
  IF NEW.source_module IS DISTINCT FROM OLD.source_module
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
  THEN
    RAISE EXCEPTION 'charge source is immutable';
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'charge currency is immutable';
  END IF;
  IF NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
    OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor
    OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor
    OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
  THEN
    RAISE EXCEPTION 'charge amounts are immutable';
  END IF;
  IF NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'charge issued_at is immutable';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'charge created_by is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'charge created_at is immutable';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'charge customer_id is immutable';
  END IF;
  IF OLD.status = 'PAID' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'paid charge status is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_charges_invariants
  BEFORE UPDATE ON finance_charges
  FOR EACH ROW
  EXECUTE FUNCTION enforce_finance_charge_row_invariants();

CREATE OR REPLACE FUNCTION reject_finance_charge_item_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'charge items are immutable';
END;
$$;

CREATE TRIGGER trg_finance_charge_items_no_update
  BEFORE UPDATE ON finance_charge_items
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_charge_item_update();

CREATE OR REPLACE FUNCTION reject_finance_payment_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'completed payments are immutable';
END;
$$;

CREATE TRIGGER trg_finance_payments_no_update
  BEFORE UPDATE ON finance_payments
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_payment_update();

CREATE OR REPLACE FUNCTION reject_finance_allocation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment allocations are immutable';
END;
$$;

CREATE TRIGGER trg_finance_payment_allocations_no_update
  BEFORE UPDATE ON finance_payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_allocation_update();

CREATE OR REPLACE FUNCTION reject_finance_history_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial history cannot be deleted';
END;
$$;

CREATE TRIGGER trg_finance_charges_no_delete
  BEFORE DELETE ON finance_charges
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

CREATE TRIGGER trg_finance_charge_items_no_delete
  BEFORE DELETE ON finance_charge_items
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

CREATE TRIGGER trg_finance_payments_no_delete
  BEFORE DELETE ON finance_payments
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

CREATE TRIGGER trg_finance_payment_allocations_no_delete
  BEFORE DELETE ON finance_payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

CREATE OR REPLACE FUNCTION enforce_finance_allocation_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  charge_total bigint;
  allocated bigint;
BEGIN
  SELECT total_minor INTO charge_total
  FROM finance_charges
  WHERE id = NEW.charge_id AND organization_id = NEW.organization_id
  FOR UPDATE;
  IF charge_total IS NULL THEN
    RAISE EXCEPTION 'charge not found for allocation';
  END IF;

  SELECT COALESCE(SUM(amount_minor), 0) INTO allocated
  FROM finance_payment_allocations
  WHERE charge_id = NEW.charge_id AND organization_id = NEW.organization_id;

  IF allocated > charge_total THEN
    RAISE EXCEPTION 'allocated payments exceed charge total'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_finance_allocation_balance
  AFTER INSERT ON finance_payment_allocations
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION enforce_finance_allocation_balance();

-- ---------------------------------------------------------------------------
-- RLS — tenant match only. No bypass GUC or function.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_payment_methods',
    'finance_charges',
    'finance_charge_items',
    'finance_payments',
    'finance_payment_allocations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY finance_payment_methods_tenant ON finance_payment_methods
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY finance_charges_tenant ON finance_charges
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY finance_charge_items_tenant ON finance_charge_items
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY finance_payments_tenant ON finance_payments
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY finance_payment_allocations_tenant ON finance_payment_allocations
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- ---------------------------------------------------------------------------
-- Privileges: no DELETE on financial or billed session history for gaming_app.
-- Default privileges from 0001 would otherwise grant DELETE on new tables.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON
  gaming_sessions,
  gaming_session_segments,
  gaming_session_pauses
FROM gaming_app;

REVOKE ALL ON finance_payment_methods FROM gaming_app;
GRANT SELECT, INSERT, UPDATE ON finance_payment_methods TO gaming_app;

REVOKE ALL ON finance_charges FROM gaming_app;
GRANT SELECT, INSERT, UPDATE ON finance_charges TO gaming_app;

REVOKE ALL ON finance_charge_items FROM gaming_app;
GRANT SELECT, INSERT ON finance_charge_items TO gaming_app;

REVOKE ALL ON finance_payments FROM gaming_app;
GRANT SELECT, INSERT ON finance_payments TO gaming_app;

REVOKE ALL ON finance_payment_allocations FROM gaming_app;
GRANT SELECT, INSERT ON finance_payment_allocations TO gaming_app;

GRANT EXECUTE ON FUNCTION enforce_finance_payment_method_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_finance_charge_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_finance_charge_item_update() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_finance_payment_update() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_finance_allocation_update() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_finance_history_delete() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_finance_allocation_balance() TO gaming_app;
