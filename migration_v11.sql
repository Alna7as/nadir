-- ============================================================
-- migration_v11.sql — إصلاح أنواع البيانات والـ Constraints
-- للمشاريع الموجودة فقط (لو عامل Schema من الأول مش محتاج)
-- شغّل هذا الملف في Supabase SQL Editor
-- ============================================================

-- [إصلاح ①] تحويل created_at / updated_at من TEXT إلى TIMESTAMPTZ
-- ملاحظة: USING لتحويل القيم النصية الموجودة إلى timestamp
ALTER TABLE products
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING CASE WHEN created_at ~ '^\d{4}-\d{2}-\d{2}' THEN created_at::TIMESTAMPTZ ELSE NOW() END,
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ
    USING CASE WHEN updated_at ~ '^\d{4}-\d{2}-\d{2}' THEN updated_at::TIMESTAMPTZ ELSE NOW() END;

ALTER TABLE shops
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING CASE WHEN created_at ~ '^\d{4}-\d{2}-\d{2}' THEN created_at::TIMESTAMPTZ ELSE NOW() END,
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ
    USING CASE WHEN updated_at ~ '^\d{4}-\d{2}-\d{2}' THEN updated_at::TIMESTAMPTZ ELSE NOW() END;

ALTER TABLE invoices
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING CASE WHEN created_at ~ '^\d{4}-\d{2}-\d{2}' THEN created_at::TIMESTAMPTZ ELSE NOW() END,
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ
    USING CASE WHEN updated_at ~ '^\d{4}-\d{2}-\d{2}' THEN updated_at::TIMESTAMPTZ ELSE NOW() END;

ALTER TABLE stock_movements
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING CASE WHEN created_at ~ '^\d{4}-\d{2}-\d{2}' THEN created_at::TIMESTAMPTZ ELSE NOW() END;

ALTER TABLE payments
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING CASE WHEN created_at ~ '^\d{4}-\d{2}-\d{2}' THEN created_at::TIMESTAMPTZ ELSE NOW() END;

-- [إصلاح] DEFAULT NOW() للحقول المحولة
ALTER TABLE products        ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE products        ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE shops           ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE shops           ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE invoices        ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE invoices        ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE stock_movements ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE payments        ALTER COLUMN created_at SET DEFAULT NOW();

-- [إصلاح ③] UNIQUE على barcode
ALTER TABLE products
  ADD CONSTRAINT IF NOT EXISTS uq_products_barcode UNIQUE (barcode);

-- [إصلاح ②] CHECK constraints
ALTER TABLE products  ADD CONSTRAINT IF NOT EXISTS chk_price_positive    CHECK (price >= 0);
ALTER TABLE products  ADD CONSTRAINT IF NOT EXISTS chk_cost_positive     CHECK (cost  >= 0);
ALTER TABLE products  ADD CONSTRAINT IF NOT EXISTS chk_qty_positive      CHECK (quantity >= 0);
ALTER TABLE invoices  ADD CONSTRAINT IF NOT EXISTS chk_total_positive    CHECK (total >= 0);
ALTER TABLE invoices  ADD CONSTRAINT IF NOT EXISTS chk_paid_positive     CHECK (amount_paid >= 0);
ALTER TABLE invoices  ADD CONSTRAINT IF NOT EXISTS chk_status_valid
  CHECK (status IN ('pending','paid','void','draft','return'));

-- [إصلاح ④] soft delete
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- [إصلاح] UNIQUE على invoice number
ALTER TABLE invoices
  ADD CONSTRAINT IF NOT EXISTS uq_invoices_number UNIQUE (number);

-- [إصلاح ⑤] Foreign Keys
ALTER TABLE invoices
  ADD CONSTRAINT IF NOT EXISTS fk_invoices_shop
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL;

ALTER TABLE stock_movements
  ADD CONSTRAINT IF NOT EXISTS fk_stock_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE stock_movements
  ADD CONSTRAINT IF NOT EXISTS fk_stock_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE payments
  ADD CONSTRAINT IF NOT EXISTS fk_payments_shop
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL;

-- [إصلاح ⑦] Trigger لتحديث updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_shops_updated_at
  BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes جديدة
CREATE INDEX IF NOT EXISTS idx_products_is_active   ON products (is_active);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at  ON invoices (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_created_at     ON stock_movements (created_at DESC);

-- ============================================================
-- للتحقق من نجاح التطبيق:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('products','invoices','shops','payments','stock_movements')
  AND column_name IN ('created_at','updated_at')
ORDER BY table_name;
-- يجب أن ترى: timestamp with time zone
-- ============================================================
