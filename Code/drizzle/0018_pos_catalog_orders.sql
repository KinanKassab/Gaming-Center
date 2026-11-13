-- 0018_pos_catalog_orders.sql
-- Milestone 9 slice: session-linked POS catalog + orders.
-- Does not rewrite 0001–0017. Does not add inventory movements/balances.
-- Gaming billing / existing gaming charges are untouched.
--
-- POS charges use source_module='pos', source_type='order', source_id=order_id.
-- Ad-hoc customer-ledger drinks (source_type='drink') remain separate.

-- ---------------------------------------------------------------------------
-- Permission registry
-- ---------------------------------------------------------------------------
INSERT INTO core_permissions (code, module, name, description, risk_level) VALUES
  ('pos.catalog.read', 'pos', 'Read POS catalog', 'View products and prices', 'LOW'),
  ('pos.catalog.manage', 'pos', 'Manage POS catalog', 'Create or archive products and set prices', 'MEDIUM'),
  ('pos.orders.read', 'pos', 'Read POS orders', 'View session-linked POS orders', 'LOW'),
  ('pos.orders.create', 'pos', 'Create POS orders', 'Sell drinks/products on a session and create POS charges', 'HIGH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core_role_permissions (organization_id, role_id, permission_code)
SELECT r.organization_id, r.id, p.code
FROM core_roles r
CROSS JOIN (
  VALUES
    ('pos.catalog.read'),
    ('pos.catalog.manage'),
    ('pos.orders.read'),
    ('pos.orders.create')
) AS p(code)
WHERE r.is_system = true
  AND r.code = 'OWNER'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- catalog_categories (organization)
-- ---------------------------------------------------------------------------
CREATE TABLE catalog_categories (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  parent_id uuid,
  code text,
  name text NOT NULL,
  status text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_categories_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT catalog_categories_name_chk
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT catalog_categories_status_chk
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT catalog_categories_parent_fk
    FOREIGN KEY (parent_id, organization_id)
    REFERENCES catalog_categories (id, organization_id)
);

CREATE UNIQUE INDEX catalog_categories_org_code_key
  ON catalog_categories (organization_id, code)
  WHERE code IS NOT NULL;

CREATE INDEX catalog_categories_org_status_idx
  ON catalog_categories (organization_id, status);

-- ---------------------------------------------------------------------------
-- catalog_products (organization)
-- ---------------------------------------------------------------------------
CREATE TABLE catalog_products (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  category_id uuid,
  code text NOT NULL,
  sku text,
  barcode text,
  name text NOT NULL,
  product_type text NOT NULL,
  track_inventory boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_products_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT catalog_products_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT catalog_products_code_chk
    CHECK (char_length(btrim(code)) > 0 AND code = upper(code)),
  CONSTRAINT catalog_products_name_chk
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT catalog_products_type_chk
    CHECK (product_type IN ('STOCK', 'SERVICE', 'NON_STOCK')),
  CONSTRAINT catalog_products_status_chk
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT catalog_products_category_fk
    FOREIGN KEY (category_id, organization_id)
    REFERENCES catalog_categories (id, organization_id)
);

CREATE UNIQUE INDEX catalog_products_org_sku_key
  ON catalog_products (organization_id, sku)
  WHERE sku IS NOT NULL;

CREATE INDEX catalog_products_org_status_idx
  ON catalog_products (organization_id, status);

CREATE INDEX catalog_products_org_barcode_idx
  ON catalog_products (organization_id, barcode);

CREATE OR REPLACE FUNCTION set_catalog_products_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_catalog_products_updated_at
  BEFORE UPDATE ON catalog_products
  FOR EACH ROW
  EXECUTE FUNCTION set_catalog_products_updated_at();

-- ---------------------------------------------------------------------------
-- catalog_product_prices (org default or branch override)
-- ---------------------------------------------------------------------------
CREATE TABLE catalog_product_prices (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  product_id uuid NOT NULL,
  branch_id uuid,
  currency char(3) NOT NULL,
  amount_minor bigint NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_product_prices_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT catalog_product_prices_product_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES catalog_products (id, organization_id),
  CONSTRAINT catalog_product_prices_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT catalog_product_prices_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT catalog_product_prices_amount_chk
    CHECK (amount_minor >= 0),
  CONSTRAINT catalog_product_prices_window_chk
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX catalog_product_prices_lookup_idx
  ON catalog_product_prices (organization_id, product_id, branch_id, valid_from DESC);

-- ---------------------------------------------------------------------------
-- pos_orders (branch)
-- ---------------------------------------------------------------------------
CREATE TABLE pos_orders (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  branch_id uuid NOT NULL,
  customer_id uuid,
  order_number text NOT NULL,
  status text NOT NULL,
  subtotal_minor bigint NOT NULL,
  discount_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL,
  opened_by uuid NOT NULL REFERENCES core_users (id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  charge_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_orders_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT pos_orders_id_org_branch_key UNIQUE (id, organization_id, branch_id),
  CONSTRAINT pos_orders_org_branch_number_key UNIQUE (organization_id, branch_id, order_number),
  CONSTRAINT pos_orders_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES core_branches (id, organization_id),
  CONSTRAINT pos_orders_customer_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES core_customers (id, organization_id),
  CONSTRAINT pos_orders_charge_fk
    FOREIGN KEY (charge_id, organization_id)
    REFERENCES finance_charges (id, organization_id),
  CONSTRAINT pos_orders_status_chk
    CHECK (status IN ('DRAFT', 'OPEN', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT pos_orders_money_chk
    CHECK (
      subtotal_minor >= 0
      AND discount_minor >= 0
      AND tax_minor >= 0
      AND total_minor >= 0
      AND total_minor = subtotal_minor - discount_minor + tax_minor
    )
);

CREATE INDEX pos_orders_org_branch_opened_idx
  ON pos_orders (organization_id, branch_id, opened_at DESC);

-- ---------------------------------------------------------------------------
-- pos_order_items
-- ---------------------------------------------------------------------------
CREATE TABLE pos_order_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  order_id uuid NOT NULL,
  product_id uuid,
  description_snapshot text NOT NULL,
  quantity numeric(18, 3) NOT NULL,
  unit_amount_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_order_items_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT pos_order_items_order_fk
    FOREIGN KEY (order_id, organization_id)
    REFERENCES pos_orders (id, organization_id),
  CONSTRAINT pos_order_items_product_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES catalog_products (id, organization_id),
  CONSTRAINT pos_order_items_description_chk
    CHECK (char_length(btrim(description_snapshot)) > 0),
  CONSTRAINT pos_order_items_quantity_chk
    CHECK (quantity > 0),
  CONSTRAINT pos_order_items_money_chk
    CHECK (unit_amount_minor >= 0 AND total_minor >= 0)
);

CREATE INDEX pos_order_items_org_order_idx
  ON pos_order_items (organization_id, order_id);

-- ---------------------------------------------------------------------------
-- gaming_session_order_links
-- ---------------------------------------------------------------------------
CREATE TABLE gaming_session_order_links (
  organization_id uuid NOT NULL REFERENCES core_organizations (id),
  session_id uuid NOT NULL,
  order_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gaming_session_order_links_pk PRIMARY KEY (session_id, order_id),
  CONSTRAINT gaming_session_order_links_session_fk
    FOREIGN KEY (session_id, organization_id)
    REFERENCES gaming_sessions (id, organization_id),
  CONSTRAINT gaming_session_order_links_order_fk
    FOREIGN KEY (order_id, organization_id)
    REFERENCES pos_orders (id, organization_id)
);

CREATE INDEX gaming_session_order_links_order_idx
  ON gaming_session_order_links (order_id);

CREATE INDEX gaming_session_order_links_org_session_idx
  ON gaming_session_order_links (organization_id, session_id);

-- ---------------------------------------------------------------------------
-- Immutability helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_catalog_product_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'catalog product id is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'catalog product organization_id is immutable';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'catalog product code is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'catalog product created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_catalog_products_invariants
  BEFORE UPDATE ON catalog_products
  FOR EACH ROW
  EXECUTE FUNCTION enforce_catalog_product_row_invariants();

CREATE OR REPLACE FUNCTION reject_catalog_product_price_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'catalog product prices are immutable; insert a new price row';
END;
$$;

CREATE TRIGGER trg_catalog_product_prices_no_update
  BEFORE UPDATE ON catalog_product_prices
  FOR EACH ROW
  EXECUTE FUNCTION reject_catalog_product_price_update();

CREATE OR REPLACE FUNCTION enforce_pos_order_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.order_number IS DISTINCT FROM OLD.order_number
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'pos order ownership fields are immutable';
  END IF;
  IF OLD.status = 'COMPLETED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'completed pos orders cannot change status';
  END IF;
  IF OLD.charge_id IS NOT NULL AND NEW.charge_id IS DISTINCT FROM OLD.charge_id THEN
    RAISE EXCEPTION 'pos order charge_id is immutable once set';
  END IF;
  IF OLD.status = 'COMPLETED' AND (
       NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
    OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor
    OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor
    OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
  ) THEN
    RAISE EXCEPTION 'completed pos order amounts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pos_orders_invariants
  BEFORE UPDATE ON pos_orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_pos_order_row_invariants();

CREATE OR REPLACE FUNCTION reject_pos_order_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pos order items are immutable';
END;
$$;

CREATE TRIGGER trg_pos_order_items_no_update
  BEFORE UPDATE ON pos_order_items
  FOR EACH ROW
  EXECUTE FUNCTION reject_pos_order_item_mutation();

CREATE TRIGGER trg_pos_order_items_no_delete
  BEFORE DELETE ON pos_order_items
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

CREATE TRIGGER trg_pos_orders_no_delete
  BEFORE DELETE ON pos_orders
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

CREATE TRIGGER trg_gaming_session_order_links_no_delete
  BEFORE DELETE ON gaming_session_order_links
  FOR EACH ROW
  EXECUTE FUNCTION reject_finance_history_delete();

CREATE OR REPLACE FUNCTION reject_gaming_session_order_link_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'session order links are immutable';
END;
$$;

CREATE TRIGGER trg_gaming_session_order_links_no_update
  BEFORE UPDATE ON gaming_session_order_links
  FOR EACH ROW
  EXECUTE FUNCTION reject_gaming_session_order_link_update();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_products FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE gaming_session_order_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaming_session_order_links FORCE ROW LEVEL SECURITY;

CREATE POLICY catalog_categories_tenant ON catalog_categories
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY catalog_products_tenant ON catalog_products
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY catalog_product_prices_tenant ON catalog_product_prices
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY pos_orders_tenant ON pos_orders
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY pos_order_items_tenant ON pos_order_items
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY gaming_session_order_links_tenant ON gaming_session_order_links
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON catalog_categories FROM gaming_app;
GRANT SELECT, INSERT, UPDATE ON catalog_categories TO gaming_app;

REVOKE ALL ON catalog_products FROM gaming_app;
GRANT SELECT, INSERT, UPDATE ON catalog_products TO gaming_app;

REVOKE ALL ON catalog_product_prices FROM gaming_app;
GRANT SELECT, INSERT ON catalog_product_prices TO gaming_app;

REVOKE ALL ON pos_orders FROM gaming_app;
GRANT SELECT, INSERT, UPDATE ON pos_orders TO gaming_app;

REVOKE ALL ON pos_order_items FROM gaming_app;
GRANT SELECT, INSERT ON pos_order_items TO gaming_app;

REVOKE ALL ON gaming_session_order_links FROM gaming_app;
GRANT SELECT, INSERT ON gaming_session_order_links TO gaming_app;

GRANT EXECUTE ON FUNCTION set_catalog_products_updated_at() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_catalog_product_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_catalog_product_price_update() TO gaming_app;
GRANT EXECUTE ON FUNCTION enforce_pos_order_row_invariants() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_pos_order_item_mutation() TO gaming_app;
GRANT EXECUTE ON FUNCTION reject_gaming_session_order_link_update() TO gaming_app;
