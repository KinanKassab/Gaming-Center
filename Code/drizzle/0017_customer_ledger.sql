-- 0017_customer_ledger.sql
-- Customer portal token plus an append-only statement of account.
-- Debt and payments remain finance_charges / finance_payments.
-- The ledger records each customer-facing line; it is not a stored balance.

-- ---------------------------------------------------------------------------
-- Unguessable public token. Distinct from core_customers.id.
-- ---------------------------------------------------------------------------
ALTER TABLE core_customers
  ADD COLUMN portal_token uuid;

UPDATE core_customers
SET portal_token = gen_random_uuid()
WHERE portal_token IS NULL;

ALTER TABLE core_customers
  ALTER COLUMN portal_token SET NOT NULL;

CREATE UNIQUE INDEX core_customers_portal_token_key
  ON core_customers (portal_token);

CREATE OR REPLACE FUNCTION enforce_customer_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'customer id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'customer organization_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'customer created_at is immutable';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'customer created_by is immutable';
  END IF;
  IF NEW.created_branch_id IS DISTINCT FROM OLD.created_branch_id THEN
    RAISE EXCEPTION 'customer created_branch_id is immutable';
  END IF;
  IF NEW.portal_token IS DISTINCT FROM OLD.portal_token THEN
    RAISE EXCEPTION 'customer portal_token is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- Safe cast of the request-scoped portal token. Invalid values yield NULL.
CREATE OR REPLACE FUNCTION app_portal_token()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('app.portal_token', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('app.portal_token', true)::uuid
    ELSE NULL
  END
$$;

-- Extra SELECT path for the public statement. Writes stay organization-scoped.
CREATE POLICY core_customers_portal_select ON core_customers
  FOR SELECT
  USING (portal_token = app_portal_token());

CREATE POLICY core_organizations_portal_select ON core_organizations
  FOR SELECT
  USING (
    id IN (
      SELECT c.organization_id
      FROM core_customers c
      WHERE c.portal_token = app_portal_token()
    )
  );

-- ---------------------------------------------------------------------------
-- Append-only customer statement lines.
-- DEBIT increases what the customer owes. CREDIT decreases it (or adds credit).
-- ---------------------------------------------------------------------------
CREATE TABLE finance_customer_ledger_entries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  entry_kind text NOT NULL,
  direction text NOT NULL,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  description text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_module text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  charge_id uuid,
  payment_id uuid,
  created_by uuid REFERENCES core_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_customer_ledger_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT finance_customer_ledger_source_key UNIQUE (organization_id, source_module, source_type, source_id),
  CONSTRAINT finance_customer_ledger_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT finance_customer_ledger_customer_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES core_customers (id, organization_id),
  CONSTRAINT finance_customer_ledger_charge_fk
    FOREIGN KEY (charge_id, organization_id)
    REFERENCES finance_charges (id, organization_id),
  CONSTRAINT finance_customer_ledger_payment_fk
    FOREIGN KEY (payment_id, organization_id)
    REFERENCES finance_payments (id, organization_id),
  CONSTRAINT finance_customer_ledger_kind_chk
    CHECK (entry_kind IN ('OPENING_DEBT', 'OPENING_CREDIT', 'PAYMENT', 'GAMING', 'DRINK')),
  CONSTRAINT finance_customer_ledger_direction_chk
    CHECK (direction IN ('DEBIT', 'CREDIT')),
  CONSTRAINT finance_customer_ledger_amount_chk
    CHECK (amount_minor > 0),
  CONSTRAINT finance_customer_ledger_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_customer_ledger_description_chk
    CHECK (char_length(btrim(description)) > 0)
);

CREATE INDEX finance_customer_ledger_customer_time_idx
  ON finance_customer_ledger_entries (organization_id, customer_id, occurred_at);

CREATE OR REPLACE FUNCTION reject_customer_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer ledger entries are immutable';
END;
$$;

CREATE TRIGGER trg_finance_customer_ledger_no_update
  BEFORE UPDATE ON finance_customer_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION reject_customer_ledger_mutation();

CREATE TRIGGER trg_finance_customer_ledger_no_delete
  BEFORE DELETE ON finance_customer_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

-- Backfill before RLS so a non-superuser migration role can insert history.
INSERT INTO finance_customer_ledger_entries (
  id, organization_id, branch_id, customer_id,
  entry_kind, direction, amount_minor, currency, description,
  occurred_at, source_module, source_type, source_id, charge_id, created_by
)
SELECT
  gen_random_uuid(),
  c.organization_id,
  c.branch_id,
  c.customer_id,
  'GAMING',
  'DEBIT',
  c.total_minor,
  c.currency,
  COALESCE(
    (
      SELECT i.description_snapshot
      FROM finance_charge_items i
      WHERE i.charge_id = c.id
        AND i.organization_id = c.organization_id
      ORDER BY i.created_at
      LIMIT 1
    ),
    'Gaming'
  ),
  c.issued_at,
  'gaming',
  'session_charge',
  c.id,
  c.id,
  c.created_by
FROM finance_charges c
WHERE c.customer_id IS NOT NULL
  AND c.total_minor > 0
  AND c.source_module = 'gaming'
  AND c.source_type = 'session';

INSERT INTO finance_customer_ledger_entries (
  id, organization_id, branch_id, customer_id,
  entry_kind, direction, amount_minor, currency, description,
  occurred_at, source_module, source_type, source_id, payment_id, created_by
)
SELECT
  gen_random_uuid(),
  p.organization_id,
  p.branch_id,
  p.customer_id,
  'PAYMENT',
  'CREDIT',
  p.amount_minor,
  p.currency,
  'Payment',
  p.received_at,
  'finance',
  'payment',
  p.id,
  p.id,
  p.created_by
FROM finance_payments p
WHERE p.customer_id IS NOT NULL
  AND p.amount_minor > 0;

ALTER TABLE finance_customer_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_customer_ledger_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY finance_customer_ledger_tenant ON finance_customer_ledger_entries
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY finance_customer_ledger_portal_select ON finance_customer_ledger_entries
  FOR SELECT
  USING (
    customer_id IN (
      SELECT c.id
      FROM core_customers c
      WHERE c.portal_token = app_portal_token()
        AND c.organization_id = finance_customer_ledger_entries.organization_id
    )
  );

REVOKE ALL ON finance_customer_ledger_entries FROM gaming_app;
GRANT SELECT, INSERT ON finance_customer_ledger_entries TO gaming_app;
GRANT EXECUTE ON FUNCTION app_portal_token() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_customer_ledger_mutation() TO gaming_app;
