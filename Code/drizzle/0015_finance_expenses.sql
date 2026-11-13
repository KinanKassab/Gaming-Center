-- 0015_finance_expenses.sql
-- Purpose: Till withdrawals for buying supplies (finance_expense_categories +
-- finance_expenses). Blueprint finance expenses without cash shifts, POS, or
-- inventory. Does not rewrite 0001–0014. Does not add finance_cash_shifts.
--
-- cash_shift_id is omitted until cash shifts exist. payment_method_id is
-- nullable; the withdrawal UI records CASH. POSTED rows are append-only.
-- Void (status + reason) is not in this slice.
--
-- 1. finance.expenses.read / .create; OWNER backfill.
-- 2. Categories (org) + expenses (branch); composite FKs; RLS FORCE.
-- 3. Seed PURCHASE category. gaming_app SELECT/INSERT (UPDATE on categories).

-- ---------------------------------------------------------------------------
-- Permission registry
-- ---------------------------------------------------------------------------
INSERT INTO core_permissions (code, module, name, description, risk_level) VALUES
  ('finance.expenses.read', 'finance', 'Read expenses', 'View till withdrawals and posted expenses', 'LOW'),
  ('finance.expenses.create', 'finance', 'Record expenses', 'Record a till withdrawal for a purchase', 'HIGH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core_role_permissions (organization_id, role_id, permission_code)
SELECT r.organization_id, r.id, p.code
FROM core_roles r
CROSS JOIN (
  VALUES
    ('finance.expenses.read'),
    ('finance.expenses.create')
) AS p(code)
WHERE r.is_system = true
  AND r.code = 'OWNER'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- finance_expense_categories (organization-owned)
-- ---------------------------------------------------------------------------
CREATE TABLE finance_expense_categories (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_expense_categories_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT finance_expense_categories_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT finance_expense_categories_code_chk
    CHECK (char_length(btrim(code)) > 0 AND code = upper(code)),
  CONSTRAINT finance_expense_categories_name_chk
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT finance_expense_categories_status_chk
    CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

CREATE INDEX finance_expense_categories_org_status_idx
  ON finance_expense_categories (organization_id, status);

-- ---------------------------------------------------------------------------
-- finance_expenses (branch-owned posted withdrawal; no physical delete)
-- ---------------------------------------------------------------------------
CREATE TABLE finance_expenses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  category_id uuid NOT NULL,
  payment_method_id uuid,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES core_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_expenses_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT finance_expenses_id_org_branch_key UNIQUE (id, organization_id, branch_id),
  CONSTRAINT finance_expenses_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT finance_expenses_category_fk
    FOREIGN KEY (category_id, organization_id)
    REFERENCES finance_expense_categories (id, organization_id),
  CONSTRAINT finance_expenses_method_fk
    FOREIGN KEY (payment_method_id, organization_id)
    REFERENCES finance_payment_methods (id, organization_id),
  CONSTRAINT finance_expenses_status_chk
    CHECK (status IN ('POSTED', 'VOIDED')),
  CONSTRAINT finance_expenses_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_expenses_amount_chk
    CHECK (amount_minor > 0),
  CONSTRAINT finance_expenses_description_chk
    CHECK (char_length(btrim(description)) > 0)
);

CREATE INDEX finance_expenses_org_branch_occurred_idx
  ON finance_expenses (organization_id, branch_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Seed PURCHASE for existing organizations
-- ---------------------------------------------------------------------------
INSERT INTO finance_expense_categories (id, organization_id, code, name, status)
SELECT gen_random_uuid(), o.id, 'PURCHASE', 'Purchase', 'ACTIVE'
FROM core_organizations o
ON CONFLICT (organization_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_finance_expense_category_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'expense category id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'expense category organization_id is immutable';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'expense category code is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expense category created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_expense_categories_invariants
  BEFORE UPDATE ON finance_expense_categories
  FOR EACH ROW
  EXECUTE FUNCTION enforce_finance_expense_category_row_invariants();

CREATE OR REPLACE FUNCTION reject_finance_expense_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'posted expenses are immutable';
END;
$$;

CREATE TRIGGER trg_finance_expenses_no_update
  BEFORE UPDATE ON finance_expenses
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_expense_update();

CREATE TRIGGER trg_finance_expense_categories_no_delete
  BEFORE DELETE ON finance_expense_categories
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

CREATE TRIGGER trg_finance_expenses_no_delete
  BEFORE DELETE ON finance_expenses
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

-- ---------------------------------------------------------------------------
-- RLS — tenant match only. No bypass GUC or function.
-- ---------------------------------------------------------------------------
ALTER TABLE finance_expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_expense_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE finance_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_expenses FORCE ROW LEVEL SECURITY;

CREATE POLICY finance_expense_categories_tenant ON finance_expense_categories
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY finance_expenses_tenant ON finance_expenses
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- ---------------------------------------------------------------------------
-- Privileges: no DELETE. Default privileges from 0001/0010 would still grant
-- SELECT/INSERT/UPDATE; be explicit like 0009.
-- ---------------------------------------------------------------------------
REVOKE ALL ON finance_expense_categories FROM gaming_app;
GRANT SELECT, INSERT, UPDATE ON finance_expense_categories TO gaming_app;

REVOKE ALL ON finance_expenses FROM gaming_app;
GRANT SELECT, INSERT ON finance_expenses TO gaming_app;

GRANT EXECUTE ON FUNCTION enforce_finance_expense_category_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_finance_expense_update() TO gaming_app;
